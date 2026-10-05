import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
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
