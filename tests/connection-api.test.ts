import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { connectionRequest } from '@/lib/connection-api';
import { resolveCred } from '@/lib/creds';

vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn() }));
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
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', '');
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]);
  auth.open.mockImplementation((id: string) => { const db = dbs.get(id); if (!db) throw new Error('wrong scope'); return db; });
  identity();
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.clearAllMocks(); });
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
