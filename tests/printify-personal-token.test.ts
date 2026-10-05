import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { connectionRequest } from '@/lib/connection-api';
import { cloudRequest } from '@/lib/cloud-api';
import { saveCredential, resolveCred, saveVaultValue, revokeCredential } from '@/lib/creds';
import { configureSource, sourceView } from '@/lib/cloud-sources';
import { collectCloud } from '@/lib/cloud-adapters';
import { discoverResources } from '@/lib/cloud-resources';
import { syncSource, runCloudTick } from '@/lib/cloud-jobs';
import { CloudError } from '@/lib/cloud-http';
import { validatePrintifyToken, PRINTIFY_RECONNECT, PRINTIFY_TOKEN_REJECTED, PRINTIFY_UNREACHABLE } from '@/lib/printify-credentials';

vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: auth.session, getActiveMember: auth.member, getFullOrganization: auth.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: (id: string) => auth.open(id), withWorkspaceDb: (id: string, work: (db: unknown) => unknown) => work(auth.open(id)) }));
vi.mock('@/lib/workspace-jobs', () => ({ listWorkspaces: auth.list }));
const A = 'A'.repeat(32), B = 'B'.repeat(32), name = 'PRINTIFY_API_TOKEN', token = 'synthetic-personal-secret';
let dbs: Map<string, ReturnType<typeof openDb>>, active = A;
const ctx = (id = A) => ({ workspace: { id }, db: dbs.get(id)! });
function identity(id = A, role = 'owner') {
  active = id;
  auth.session.mockResolvedValue({ user: { id: 'user', email: 'test@example.com', name: 'Test' }, session: { activeOrganizationId: id } });
  auth.member.mockResolvedValue({ role, organizationId: id, userId: 'user' });
  auth.organization.mockResolvedValue({ id, name: id, metadata: { kind: 'client' } });
}
function request(method: string, body?: unknown, extra?: Record<string, string>) {
  return new Request('http://localhost:4100/api/admin/connections', { method, headers: { cookie: 'better-auth.session_token=test', origin: 'http://localhost:4100', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const save = () => connectionRequest(request('POST', { name, value: token }));
const oauth = (expires = Date.now() + 3600000) => saveVaultValue(ctx(), 'oauth:printify:tokens', JSON.stringify({ access: 'oauth-fixture', expires, generation: 'oauth-one' }));
const reportFetch = () => vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/shops.json') ? Response.json([{ id: 123, title: 'Fixture shop' }]) : Response.json({ data: [], total: 0 }));
beforeEach(() => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex')); vi.stubEnv('OMEGA_PRINTIFY_ENABLED', '');
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]);
  auth.open.mockImplementation(id => dbs.get(id)); auth.list.mockResolvedValue([{ id: A, name: 'A', kind: 'client' }, { id: B, name: 'B', kind: 'client' }]);
  identity();
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

test('save validates a fixed GET before encryption, discards body and never returns or logs a secret', async () => {
  const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    expect(ctx().db.connectionRecords.get(name)).toBeUndefined();
    return Response.json({ confidential: 'body-must-not-be-stored' });
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await save(); expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual(['https://api.printify.com/v1/shops.json', expect.objectContaining({ method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OmegaOS' }, signal: expect.any(AbortSignal) })]);
  expect(resolveCred(ctx(), name)).toBe(token);
  const text = await response.text(), records = JSON.stringify(ctx().db.connectionRecords.all());
  for (const secret of [token, 'body-must-not-be-stored']) { expect(text).not.toContain(secret); expect(records).not.toContain(secret); expect(JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls])).not.toContain(secret); }
  expect(JSON.parse(text).connections.find((r: { name: string }) => r.name === name).status).toBe('saved');
  expect(sourceView(ctx(), 'printify')).toMatchObject({ connectionMethod: 'Personal token', status: 'needs_setup', appReady: false });
});

test.each([401, 403, 201, 204, 302, 429, 500])('status %s does not save or overwrite an existing token', async status => {
  saveCredential(ctx(), name, 'previous-fixture');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
  const response = await save(); expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: [401, 403].includes(status) ? PRINTIFY_TOKEN_REJECTED : PRINTIFY_UNREACHABLE });
  expect(resolveCred(ctx(), name)).toBe('previous-fixture');
  identity(B); expect((await save()).status).toBe(400); expect(ctx(B).db.connectionRecords.get(name)).toBeUndefined();
});

test('network errors and timeout are sanitized, bounded and never saved', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(token)));
  const response = await save(); expect(await response.json()).toEqual({ error: PRINTIFY_UNREACHABLE });
  expect(ctx().db.connectionRecords.get(name)).toBeUndefined();
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const hanging = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const validation = validatePrintifyToken(token, hanging);
  const rejection = expect(validation).rejects.toThrow(PRINTIFY_UNREACHABLE);
  controller.abort(); await rejection; expect(timeout).toHaveBeenCalledWith(10_000); expect(hanging).toHaveBeenCalledOnce();
});

test('viewer and member cannot save/remove; origin and stale workspace block before provider I/O', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const role of ['member', 'viewer']) {
    identity(A, role); expect((await save()).status).toBe(403);
    expect((await connectionRequest(request('DELETE', { name }))).status).toBe(403);
  }
  identity();
  expect((await connectionRequest(request('POST', { name, value: token }, { origin: 'https://evil.test' }))).status).toBe(403);
  expect((await connectionRequest(request('POST', { name, value: token }, { 'x-omegaos-workspace': B }))).status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each(['workspace', 'role', 'replace', 'remove'])('save discards a validation result after concurrent %s', async change => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (change === 'workspace') identity(B);
    if (change === 'role') identity(A, 'viewer');
    if (change === 'replace') saveCredential(ctx(), name, 'newer-fixture');
    if (change === 'remove') revokeCredential(ctx(), name);
    return new Response(null, { status: 200 });
  }));
  expect((await save()).status).toBe(change === 'role' ? 403 : 409);
  expect(resolveCred(ctx(), name)).toBe(change === 'replace' ? 'newer-fixture' : undefined);
  expect(resolveCred(ctx(B), name)).toBeUndefined();
});

test('discovery and collector use workspace PAT without app approval; OAuth always takes priority', async () => {
  saveCredential(ctx(), name, token); const fetcher = reportFetch();
  expect(await discoverResources(ctx(), 'printify', fetcher)).toMatchObject({ resources: [{ id: '123', label: 'Fixture shop' }] });
  const options = { now: new Date(), signal: AbortSignal.timeout(5000), fetcher };
  expect((await collectCloud(ctx(), 'printify', '123', options)).values).toEqual({ products: 0, orders: 0, fulfilled: 0 });
  expect(fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get('authorization') === `Bearer ${token}`)).toBe(true);
  fetcher.mockClear(); oauth();
  expect(sourceView(ctx(), 'printify').connectionMethod).toBe('Printify sign-in');
  await collectCloud(ctx(), 'printify', '123', options);
  expect(fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get('authorization') === 'Bearer oauth-fixture')).toBe(true);
  fetcher.mockClear(); oauth(0);
  await expect(collectCloud(ctx(), 'printify', '123', options)).rejects.toThrow('permission'); expect(fetcher).not.toHaveBeenCalled();
});

test('no environment or cross-workspace fallback, even when another workspace has a saved token', async () => {
  saveCredential(ctx(), name, token); vi.stubEnv(name, 'environment-is-forbidden'); const fetcher = reportFetch();
  expect(sourceView(ctx(B), 'printify')).toMatchObject({ connectionMethod: null, status: 'not_connected' });
  await expect(collectCloud(ctx(B), 'printify', '123', { now: new Date(), signal: AbortSignal.timeout(1000), fetcher })).rejects.toThrow('permission');
  await expect(discoverResources(ctx(B), 'printify', fetcher)).rejects.toThrow('permission'); expect(fetcher).not.toHaveBeenCalled();
});

test('both removal paths erase the token only in this workspace and invalidate pending discovery', async () => {
  saveCredential(ctx(), name, token); saveCredential(ctx(B), name, 'B-fixture');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { revokeCredential(ctx(), name); return Response.json([{ id: 123, title: 'Private' }]); });
  await expect(discoverResources(ctx(), 'printify', fetcher)).rejects.toThrow('changed');
  expect(ctx().db.connectionRecords.get(name)).toBeUndefined(); expect(resolveCred(ctx(B), name)).toBe('B-fixture');
  saveCredential(ctx(), name, token); oauth();
  expect((await cloudRequest(request('POST', { action: 'disconnect', id: 'printify' }))).status).toBe(200);
  expect(ctx().db.connectionRecords.get(name)).toBeUndefined(); expect(sourceView(ctx(), 'printify').connectionMethod).toBeNull();
  expect(resolveCred(ctx(B), name)).toBe('B-fixture');
  saveCredential(ctx(), name, token);
  expect((await connectionRequest(request('DELETE', { name }))).status).toBe(200);
  expect(ctx().db.connectionRecords.get(name)).toBeUndefined();
});

test('401 stops scheduling and manual retries until token replaced; preserves last good counts', async () => {
  saveCredential(ctx(), name, token); configureSource(ctx(), 'printify', { resource: '123', enabled: true });
  const first = new Date('2026-10-05T12:00:00Z');
  await syncSource(ctx(), 'printify', { now: first, collect: async () => ({ at: first.toISOString(), period: 'Fixture', values: { products: 2 } }) });
  const failedAt = new Date(+first + 16 * 60000), fetcher = vi.fn(async () => new Response(null, { status: 401 })); vi.stubGlobal('fetch', fetcher);
  const result = await syncSource(ctx(), 'printify', { now: failedAt });
  expect(result).toMatchObject({ ok: false, error: PRINTIFY_RECONNECT });
  expect(sourceView(ctx(), 'printify')).toMatchObject({ status: 'error', enabled: false, stale: true, snapshot: { values: { products: 2 } } });
  expect(await runCloudTick()).toEqual({ ran: 0 });
  expect(await syncSource(ctx(), 'printify', { manual: true, now: new Date(+failedAt + 3600000) })).toHaveProperty('skipped');
  expect(() => configureSource(ctx(), 'printify', { resource: '123', enabled: true })).toThrow('authentication');
  expect(fetcher).toHaveBeenCalledOnce();
  saveCredential(ctx(), name, 'replacement-fixture'); configureSource(ctx(), 'printify', { resource: '123', enabled: true });
  expect(sourceView(ctx(), 'printify')).toMatchObject({ status: 'ready', enabled: true, error: null, snapshot: null });
});

test('late 401 cannot disable a new PAT or OAuth connection', async () => {
  for (const mode of ['pat', 'oauth']) {
    saveCredential(ctx(), name, token); configureSource(ctx(), 'printify', { resource: '123', enabled: true });
    const result = await syncSource(ctx(), 'printify', { now: new Date(Date.now() + (mode === 'oauth' ? 3600000 : 0)), collect: async () => {
      if (mode === 'oauth') oauth(); else saveCredential(ctx(), name, 'newer');
      configureSource(ctx(), 'printify', { resource: '123', enabled: true }); throw new CloudError('authentication');
    } });
    expect(result).toMatchObject({ ok: false }); expect(sourceView(ctx(), 'printify')).toMatchObject({ enabled: true, status: 'ready', error: null });
  }
});

test('discovery endpoint supports personal tokens and sanitizes its result', async () => {
  saveCredential(ctx(), name, token); vi.stubGlobal('fetch', reportFetch());
  const response = await cloudRequest(request('POST', { action: 'resources', id: 'printify' }));
  expect(response.status).toBe(200); const text = await response.text(); expect(text).toContain('Fixture shop'); expect(text).not.toContain(token);
});
