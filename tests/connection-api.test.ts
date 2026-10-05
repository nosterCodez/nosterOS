import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { connectionRequest } from '@/lib/connection-api';
import { resolveCred, saveCredential } from '@/lib/creds';
import { EMAIL_FIELDS } from '@/lib/verification-types';

vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn() }));
const imap = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('imapflow', () => ({ ImapFlow: class { on() {} close() {} connect = imap.connect; } }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: auth.session, getActiveMember: auth.member, getFullOrganization: auth.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: (id: string) => auth.open(id), withWorkspaceDb: (id: string, work: (db: unknown) => unknown) => work(auth.open(id)) }));
const A = 'A'.repeat(32), B = 'B'.repeat(32);
let dbs: Map<string, ReturnType<typeof openDb>>;
let active = A;
function identity(id = A, role = 'owner') {
  active = id;
  auth.session.mockResolvedValue({ user: { id: 'user', email: 'test@example.com', name: 'Test' }, session: { activeOrganizationId: id } });
  auth.member.mockResolvedValue({ role, organizationId: id, userId: 'user' });
  auth.organization.mockResolvedValue({ id, name: id, metadata: { kind: 'client' } });
}
function call(method: string, body?: unknown, extra?: Record<string, string>) {
  return connectionRequest(new Request('http://localhost:4100/api/admin/connections', { method, headers: { cookie: 'better-auth.session_token=test', origin: 'http://localhost:4100', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }));
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  imap.connect.mockResolvedValue(undefined);
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', '');
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]);
  auth.open.mockImplementation((id: string) => { const db = dbs.get(id); if (!db) throw new Error('wrong scope'); return db; });
  identity();
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
test('owner saves, admin replaces, revokes; responses never contain secrets or key fragments', async () => {
  const key = 'private-workspace-secret-6789';
  const response = await call('POST', { name: 'OPENAI_API_KEY', value: key });
  expect(response.status).toBe(200);
  const text = await response.text(); expect(text).not.toContain(key); expect(text).not.toContain('6789'); expect(text).not.toContain('envelope');
  const a = { workspace: { id: A }, db: dbs.get(A)! };
  expect(resolveCred(a, 'OPENAI_API_KEY')).toBe(key);
  identity(A, 'admin');
  expect((await call('POST', { name: 'OPENAI_API_KEY', value: 'replacement' })).status).toBe(200);
  expect(resolveCred(a, 'OPENAI_API_KEY')).toBe('replacement');
  expect((await call('DELETE', { name: 'OPENAI_API_KEY' })).status).toBe(200);
  expect(resolveCred(a, 'OPENAI_API_KEY')).toBeUndefined();
});
test('switching workspace cannot read or mutate another workspace; body selectors rejected', async () => {
  await call('POST', { name: 'OPENAI_API_KEY', value: 'only-A' }); identity(B);
  expect((await (await call('GET')).json()).connections.every((row: { status: string }) => row.status === 'not_configured')).toBe(true);
  expect((await call('POST', { name: 'OPENAI_API_KEY', value: 'injected', workspaceId: A })).status).toBe(400);
  await call('DELETE', { name: 'OPENAI_API_KEY' });
  expect(resolveCred({ workspace: { id: A }, db: dbs.get(A)! }, 'OPENAI_API_KEY')).toBe('only-A');
});
test('viewer/member/unauthenticated requests cannot manage credentials or open storage', async () => {
  for (const role of ['viewer', 'member']) {
    identity(A, role);
    for (const method of ['GET', 'POST', 'DELETE']) expect((await call(method, method === 'GET' ? undefined : { name: 'OPENAI_API_KEY', value: 'secret' })).status).toBe(403);
  }
  auth.session.mockResolvedValue(null);
  expect((await call('GET')).status).toBe(401);
  expect(auth.open).not.toHaveBeenCalled();
});
test('cross-origin, no-origin, forged membership, unexpected names and oversized bodies fail closed', async () => {
  const body = { name: 'OPENAI_API_KEY', value: 'secret' };
  expect((await call('POST', body, { origin: 'https://attacker.example' })).status).toBe(403);
  expect((await call('POST', body, { origin: '' })).status).toBe(403);
  auth.member.mockResolvedValue({ role: 'owner', organizationId: B, userId: 'user' });
  expect((await call('POST', body)).status).toBe(403); identity();
  expect((await call('POST', { name: 'BETTER_AUTH_SECRET', value: 'secret' })).status).toBe(400);
  expect((await call('POST', { name: 'OPENAI_API_KEY', value: 'x'.repeat(9000) })).status).toBe(400);
  expect(dbs.get(A)!.connectionRecords.all()).toHaveLength(0);
});
test('missing master key disables saving without leaking configuration', async () => {
  vi.stubEnv('NOSTEROS_MASTER_KEY', '');
  expect((await (await call('GET')).json()).ready).toBe(false);
  expect((await call('POST', { name: 'OPENAI_API_KEY', value: 'private' })).status).toBe(503);
  expect(dbs.get(A)!.connectionRecords.all()).toHaveLength(0);
});
test('a form left open during a workspace switch cannot save into the new workspace', async () => {
  identity(B);
  expect((await call('POST', { name: 'OPENAI_API_KEY', value: 'stale-form' }, { 'x-omegaos-workspace': A })).status).toBe(409);
  expect(dbs.get(A)!.connectionRecords.all()).toHaveLength(0);
  expect(dbs.get(B)!.connectionRecords.all()).toHaveLength(0);
});
test('verify is admin-only, shares the five-per-minute workspace limit with saves, and returns only metadata', async () => {
  await call('POST', { name: 'OPENAI_API_KEY', value: 'secret' });
  for (const role of ['viewer', 'member']) { identity(A, role); expect((await call('POST', { name: 'OPENAI_API_KEY', action: 'verify' })).status).toBe(403); }
  identity();
  for (let i = 0; i < 4; i++) expect((await call('POST', { name: 'OPENAI_API_KEY', action: 'verify' })).status).toBe(200);
  expect((await call('POST', { name: 'OPENAI_API_KEY', action: 'verify' })).status).toBe(429);
  expect((await call('POST', { name: 'ANTHROPIC_API_KEY', value: 'new-key' })).status).toBe(429);
  identity(B); expect((await call('POST', { name: 'OPENAI_API_KEY', value: 'B-key' })).status).toBe(200);
});
test('rejected candidate keeps previous key; network failure saves with an honest status', async () => {
  const ctx = { workspace: { id: A }, db: dbs.get(A)! };
  saveCredential(ctx, 'ANTHROPIC_API_KEY', 'previous');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
  const rejected = await call('POST', { name: 'ANTHROPIC_API_KEY', value: 'candidate' });
  expect(rejected.status).toBe(400); expect(await rejected.text()).not.toContain('candidate'); expect(resolveCred(ctx, 'ANTHROPIC_API_KEY')).toBe('previous');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('candidate')));
  const response = await call('POST', { name: 'ANTHROPIC_API_KEY', value: 'candidate' });
  expect(response.status).toBe(200); expect((await response.json()).connections.find((r: { name: string }) => r.name === 'ANTHROPIC_API_KEY').status).toBe('unreachable');
  expect(resolveCred(ctx, 'ANTHROPIC_API_KEY')).toBe('candidate');
});
test('email pre-fills only host/account, rejects partial and mixed single-field writes, and replaces the trio atomically', async () => {
  const ctx = { workspace: { id: A }, db: dbs.get(A)! };
  const old = { host: 'imap.gmail.com', account: 'old@example.test', password: 'old-password' };
  const next = { host: 'imap.fastmail.com', account: 'next@example.test', password: 'new-password' };
  expect((await call('POST', { name: 'email', email: old })).status).toBe(200);
  const get = await (await call('GET')).json(); expect(get.email).toEqual({ host: old.host, account: old.account }); expect(JSON.stringify(get)).not.toContain(old.password);
  expect((await call('POST', { name: 'email', email: { ...next, password: '' } })).status).toBe(400);
  for (const name of EMAIL_FIELDS) expect((await call('POST', { name, value: 'partial' })).status).toBe(400);
  imap.connect.mockRejectedValue({ authenticationFailed: true, message: next.password });
  expect((await call('POST', { name: 'email', email: next })).status).toBe(400);
  expect(EMAIL_FIELDS.map(name => resolveCred(ctx, name))).toEqual(Object.values(old));
  imap.connect.mockRejectedValue(new Error(next.password));
  const response = await call('POST', { name: 'email', email: next }); expect(response.status).toBe(200);
  expect(EMAIL_FIELDS.map(name => resolveCred(ctx, name))).toEqual(Object.values(next));
  const body = await response.json(); expect(body.connections.filter((r: { provider: string }) => r.provider === 'email').every((r: { status: string }) => r.status === 'unreachable')).toBe(true);
  expect(JSON.stringify(body)).not.toContain(next.password);
  expect((await call('DELETE', { name: 'email' })).status).toBe(200); expect(EMAIL_FIELDS.map(name => resolveCred(ctx, name))).toEqual([undefined, undefined, undefined]);
});
test('stale email replacement is discarded after a concurrent workspace switch', async () => {
  imap.connect.mockImplementation(async () => { identity(B); });
  expect((await call('POST', { name: 'email', email: { host: 'imap.gmail.com', account: 'fixture@example.test', password: 'fixture' } })).status).toBe(409);
  expect(dbs.get(A)!.connectionRecords.all()).toHaveLength(0); expect(dbs.get(B)!.connectionRecords.all()).toHaveLength(0);
});
