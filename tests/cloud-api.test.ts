import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { saveVaultValue } from '@/lib/creds';
import { disconnectOAuth } from '@/lib/cloud-oauth';
import { cloudRequest, cloudCallback } from '@/lib/cloud-api';
vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: auth.session, getActiveMember: auth.member, getFullOrganization: auth.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: (id: string) => auth.open(id), withWorkspaceDb: (id: string, work: (db: unknown) => unknown) => work(auth.open(id)) }));
const A = 'A'.repeat(32), B = 'B'.repeat(32);
let dbs: Map<string, ReturnType<typeof openDb>>, active = A;
function identity(id = A, role = 'owner') {
  active = id;
  auth.session.mockResolvedValue({ user: { id: 'user', email: 'test@example.com', name: 'Test' }, session: { activeOrganizationId: id } });
  auth.member.mockResolvedValue({ role, organizationId: id, userId: 'user' });
  auth.organization.mockResolvedValue({ id, name: id, metadata: { kind: 'client' } });
}
function call(method = 'GET', body?: unknown, extra?: Record<string, string>) {
  return cloudRequest(new Request('http://localhost:4100/api/admin/sources', { method, headers: { cookie: 'better-auth.session_token=test', origin: 'http://localhost:4100', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }));
}
beforeEach(() => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100'); vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]); auth.open.mockImplementation((id: string) => dbs.get(id)); identity();
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.clearAllMocks(); });
const configuration = { action: 'configure', id: 'ga4', resource: '12345', enabled: true };

test('commerce authorization requires role, origin and workspace and persists only encrypted provider tokens', async () => {
  vi.stubEnv('OMEGA_PRINTIFY_ENABLED', '1'); vi.stubEnv('OMEGA_PRINTIFY_APP_ID', 'printify-app');
  vi.stubEnv('OMEGA_SHOPIFY_ENABLED', '1'); vi.stubEnv('OMEGA_SHOPIFY_CLIENT_ID', 'shopify-app'); vi.stubEnv('OMEGA_SHOPIFY_CLIENT_SECRET', 'shopify-secret');
  const fetcher = vi.fn(async () => Response.json({ access_token: 'commerce-private', refresh_token: 'refresh-private', expires_in: 3600, expire_at: new Date(Date.now() + 3600000).toISOString(), scope: 'read_products,read_orders' }));
  vi.stubGlobal('fetch', fetcher);
  try {
    for (const id of ['printify', 'shopify']) {
      const action = { action: 'authorize', id, ...(id === 'shopify' ? { shop: 'fixture.myshopify.com' } : {}) };
      identity(A, 'member'); expect((await call('POST', action)).status).toBe(403);
      identity(); expect((await call('POST', action, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await call('POST', action, { 'x-omegaos-workspace': B })).status).toBe(409);
      const start = await (await call('POST', action)).json();
      const state = new URL(start.url).searchParams.get('state')!;
      const callback = new URL(`http://localhost:4100/api/connections/oauth/${id}/callback`);
      callback.searchParams.set('code', 'fixture-code'); callback.searchParams.set('state', state);
      if (id === 'shopify') {
        callback.searchParams.set('shop', 'fixture.myshopify.com'); callback.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)));
        const message = [...callback.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
        callback.searchParams.set('hmac', createHmac('sha256', 'shopify-secret').update(message).digest('hex'));
      }
      const result = await cloudCallback(new Request(callback, { headers: { cookie: 'better-auth.session_token=test' } }), id);
      expect(result.headers.get('location')).toContain('connection=authorized');
      const body = await (await call()).json();
      expect(body.sources.find((s: { id: string }) => s.id === id)).toMatchObject({ status: 'needs_setup', enabled: false });
      expect(JSON.stringify(body)).not.toContain('commerce-private');
      expect(JSON.stringify(dbs.get(A)!.connectionRecords.all())).not.toContain('commerce-private');
      identity(B);
      expect((await (await call()).json()).sources.find((s: { id: string }) => s.id === id).status).toBe('not_connected');
      identity(A);
    }
  } finally { vi.unstubAllGlobals(); }
});
test('admin manual sync reads only its workspace and leaves recurring collection disabled', async () => {
  saveVaultValue({ workspace: { id: A }, db: dbs.get(A)! }, 'oauth:google:tokens', JSON.stringify({ access: 'fixture-token', refresh: 'fixture-refresh', expires: Date.now() + 3600000, generation: 'fixture' }));
  await call('POST', { ...configuration, enabled: false });
  const fetcher = vi.fn(async () => Response.json({ metricHeaders: [{ name: 'activeUsers' }], rows: [{ metricValues: [{ value: '12' }] }] }));
  vi.stubGlobal('fetch', fetcher);
  try {
    identity(A, 'member'); expect((await call('POST', { action: 'sync', id: 'ga4' })).status).toBe(403);
    identity(); expect((await call('POST', { action: 'sync', id: 'ga4' }, { origin: 'https://attacker.test' })).status).toBe(403);
    const result = await (await call('POST', { action: 'sync', id: 'ga4' })).json();
    expect(result.outcome.ok).toBe(true);
    expect(result.sources.find((s: { id: string }) => s.id === 'ga4')).toMatchObject({ enabled: false, snapshot: { values: { users: 12 } } });
    identity(B); expect((await (await call('POST', { action: 'sync', id: 'ga4' })).json()).outcome).toHaveProperty('skipped');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(dbs.get(B)!.cloudSources.get('ga4')).toBeUndefined();
  } finally { vi.unstubAllGlobals(); }
});
test('admin can configure only the current workspace; state and responses are isolated', async () => {
  expect((await call('POST', configuration)).status).toBe(200); identity(B, 'admin');
  const response = await (await call()).json(); expect(response.sources.find((s: { id: string }) => s.id === 'ga4').resource).toBe('');
  expect(dbs.get(A)!.cloudSources.get('ga4')?.resource).toBe('12345');
  expect((await call('POST', { ...configuration, workspaceId: A })).status).toBe(400);
  expect((await call('POST', configuration, { 'x-omegaos-workspace': A })).status).toBe(409);
  expect(dbs.get(B)!.cloudSources.get('ga4')).toBeUndefined();
});
test('members/viewers/unauthenticated requests cannot configure or authorize', async () => {
  for (const role of ['member', 'viewer']) { identity(A, role); expect((await call()).status).toBe(403); expect((await call('POST', configuration)).status).toBe(403); }
  auth.session.mockResolvedValue(null); expect((await call()).status).toBe(401); expect(auth.open).not.toHaveBeenCalled();
});
test('cross origin, invalid resource, large body and disabled broad-scope providers are rejected', async () => {
  expect((await call('POST', configuration, { origin: 'https://attacker.example' })).status).toBe(403);
  expect((await call('POST', configuration, { origin: '' })).status).toBe(403);
  expect((await call('POST', { ...configuration, resource: '../../admin' })).status).toBe(400);
  expect((await call('POST', { ...configuration, resource: 'a'.repeat(9000) })).status).toBe(400);
  for (const id of ['google-business','linkedin']) expect((await call('POST', { action: 'authorize', id })).status).toBe(400);
});
test('OAuth start never returns a verifier, access token or platform secret', async () => {
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'fixture-client'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'private-platform-secret');
  const response = await call('POST', { action: 'authorize', id: 'google' }); expect(response.status).toBe(200);
  const body = await response.text(); expect(body).not.toContain('private-platform-secret'); expect(body).not.toContain('code_verifier');
  expect(body).toContain('code_challenge'); expect(body).not.toContain('gmail');
  expect(JSON.stringify(dbs.get(A)!.connectionRecords.all())).not.toContain('code_verifier');
});
test('callback fails closed without valid state or admin session and never calls the provider', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  try {
    const request = () => new Request('http://localhost:4100/api/connections/oauth/google/callback?code=invalid&state=invalid', { headers: { cookie: 'better-auth.session_token=test' } });
    const result = await cloudCallback(request(), 'google');
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('http://localhost:4100/integrations?connection=failed');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    identity(A, 'member'); expect((await cloudCallback(request(), 'google')).status).toBe(403);
    auth.session.mockResolvedValue(null); expect((await cloudCallback(request(), 'google')).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

test('successful sign-in persists encrypted authorization across reads without enabling collection', async () => {
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'fixture-client'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'fixture-secret');
  const start = await (await call('POST', { action: 'authorize', id: 'google' })).json();
  const state = new URL(start.url).searchParams.get('state')!;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 })));
  try {
    const callback = new URL('http://localhost:4100/api/connections/oauth/google/callback');
    callback.searchParams.set('code', 'fixture-code'); callback.searchParams.set('state', state);
    const response = await cloudCallback(new Request(callback, { headers: { cookie: 'better-auth.session_token=test' } }), 'google');
    expect(response.headers.get('location')).toBe('http://localhost:4100/integrations?connection=authorized');
    for (let read = 0; read < 2; read++) {
      const body = await (await call()).json();
      const google = body.sources.filter((s: { provider?: string }) => s.provider === 'google');
      expect(google).toHaveLength(3);
      expect(google.every((s: { status: string; enabled: boolean }) => s.status === 'needs_setup' && !s.enabled)).toBe(true);
      expect(JSON.stringify(body)).not.toContain('fixture-access');
      expect(JSON.stringify(body)).not.toContain('fixture-refresh');
    }
    expect(JSON.stringify(dbs.get(A)!.connectionRecords.all())).not.toContain('fixture-access');
    identity(B);
    const other = await (await call()).json();
    expect(other.sources.find((s: { id: string }) => s.id === 'search-console').status).toBe('not_connected');
  } finally { vi.unstubAllGlobals(); }
});
test('resource discovery enforces origin, role, workspace and credential isolation', async () => {
  saveVaultValue({ workspace: { id: A }, db: dbs.get(A)! }, 'oauth:google:tokens', JSON.stringify({ access: 'private-account-token', expires: Date.now() + 3600000, generation: 'one' }));
  const fetcher = vi.fn(async () => Response.json({ siteEntry: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }] }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const action = { action: 'resources', id: 'search-console' };
    expect((await call('POST', action, { origin: 'https://other.test' })).status).toBe(403);
    expect((await call('POST', action, { 'x-omegaos-workspace': B })).status).toBe(409);
    identity(A, 'member'); expect((await call('POST', action)).status).toBe(403);
    identity(B); expect((await call('POST', action)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    identity(A);
    const result = await call('POST', action);
    expect(result.headers.get('cache-control')).toBe('no-store');
    const body = await result.text(); expect(body).toContain('https://example.com/'); expect(body).not.toContain('private-account-token');
    fetcher.mockImplementation(async () => { identity(B); return Response.json({ siteEntry: [{ siteUrl: 'https://secret.test/', permissionLevel: 'siteOwner' }] }); });
    const changed = await call('POST', action);
    expect(changed.status).toBe(400); expect(await changed.text()).not.toContain('secret.test');
    identity(A);
    fetcher.mockImplementation(async () => { identity(A, 'member'); return Response.json({ siteEntry: [] }); });
    expect((await call('POST', action)).status).toBe(403);
  } finally { vi.unstubAllGlobals(); }
});

test('Meta discovery works without Google credentials and discards changed workspace or Meta authorization', async () => {
  vi.stubEnv('OMEGA_META_API_VERSION', 'v26.0');
  const context = { workspace: { id: A }, db: dbs.get(A)! };
  saveVaultValue(context, 'oauth:meta:tokens', JSON.stringify({ access: 'private-meta-token', expires: Date.now() + 3600000, generation: 'one' }));
  const fetcher = vi.fn(async () => Response.json({ data: [{ id: '123', name: 'Business Page' }] }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const action = { action: 'resources', id: 'facebook' };
    identity(B); expect((await call('POST', action)).status).toBe(400);
    identity(A, 'member'); expect((await call('POST', action)).status).toBe(403);
    identity(A); expect((await call('POST', action, { origin: 'https://other.test' })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    const body = await (await call('POST', action)).json();
    expect(body.resources).toEqual([{ id: '123', label: 'Business Page' }]);
    expect(JSON.stringify(body)).not.toContain('private-meta-token');
    fetcher.mockImplementation(async () => { identity(B); return Response.json({ data: [{ id: '123', name: 'Secret Page' }] }); });
    expect(await (await call('POST', action)).text()).not.toContain('Secret Page');
    identity(A);
    fetcher.mockImplementation(async () => { disconnectOAuth(context, 'meta'); return Response.json({ data: [{ id: '123', name: 'Secret Page' }] }); });
    const changed = await call('POST', action);
    expect(changed.status).toBe(400); expect(await changed.text()).not.toContain('Secret Page');
  } finally { vi.unstubAllGlobals(); }
});

test('Ads discovery enforces workspace, role and origin and rechecks access after provider I/O', async () => {
  vi.stubEnv('OMEGA_GOOGLE_ADS_API_VERSION', 'v25');
  const context = { workspace: { id: A }, db: dbs.get(A)! };
  saveVaultValue(context, 'oauth:google-ads:tokens', JSON.stringify({ access: 'private-ads-token', expires: Date.now() + 3600000, generation: 'ads' }));
  const fetcher = vi.fn(async () => Response.json({ resourceNames: [] }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const action = { action: 'resources', id: 'google-ads' };
    identity(B); expect((await call('POST', action)).status).toBe(400);
    identity(A, 'member'); expect((await call('POST', action)).status).toBe(403);
    identity(A); expect((await call('POST', action, { origin: 'https://other.test' })).status).toBe(403);
    expect((await call('POST', action, { 'x-omegaos-workspace': B })).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await call('POST', action)).status).toBe(200);
    fetcher.mockImplementation(async () => { identity(B); return Response.json({ resourceNames: [] }); });
    expect((await call('POST', action)).status).toBe(400);
    identity(A);
    fetcher.mockImplementation(async () => { identity(A, 'member'); return Response.json({ resourceNames: [] }); });
    expect((await call('POST', action)).status).toBe(403);
  } finally { vi.unstubAllGlobals(); }
});
