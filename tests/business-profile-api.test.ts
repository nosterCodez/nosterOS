import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { GET, POST } from '@/app/api/business-profile/route';
import { GET as versions } from '@/app/api/business-profile/versions/route';
import { POST as restore } from '@/app/api/business-profile/restore/route';
vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: auth.session, getActiveMember: auth.member, getFullOrganization: auth.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: (id: string) => auth.open(id), withWorkspaceDb: (id: string, work: (db: unknown) => unknown) => work(auth.open(id)) }));
const A = 'A'.repeat(32), B = 'B'.repeat(32);
let dbs: Map<string, ReturnType<typeof openDb>>, active = A;
function identity(id = A, role = 'member') {
  active = id;
  auth.session.mockResolvedValue({ user: { id: 'user', email: 'test@example.com', name: 'Test' }, session: { activeOrganizationId: id } });
  auth.member.mockResolvedValue({ role, organizationId: id, userId: 'user' });
  auth.organization.mockResolvedValue({ id, name: id, metadata: { kind: 'client' } });
}
const input = { markdown: '## Business overview\nTest business' };
function request(method = 'POST', body: unknown = input, suffix = '', extra: Record<string, string> = {}) {
  return new Request(`http://localhost:4100/api/business-profile${suffix}`, { method, headers: { cookie: 'better-auth.session_token=test', origin: 'http://localhost:4100', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...extra }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]); auth.open.mockImplementation((id: string) => dbs.get(id)); identity();
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('member saves, reads, lists and restores only own workspace versions', async () => {
  const saved = await (await POST(request())).json(); expect(saved.current.version).toBe(1);
  const id = saved.current.id;
  expect((await GET(request('GET', null, `?id=${id}`))).status).toBe(200);
  const history = await (await versions(request('GET', null, '/versions'))).json();
  expect(history.versions).toHaveLength(1); expect(history.versions[0]).not.toHaveProperty('rawMarkdown');
  expect((await restore(request('POST', { id }, '/restore'))).status).toBe(200);
  expect(dbs.get(A)!.businessProfiles.current()?.version).toBe(2);
  identity(B);
  expect((await GET(request('GET', null, `?id=${id}`))).status).toBe(404);
  expect((await restore(request('POST', { id }, '/restore'))).status).toBe(404);
  expect((await (await GET(request('GET'))).json()).current).toBeNull();
});
test('viewer, unsigned, bad origin and stale workspace writes are blocked', async () => {
  identity(A, 'viewer'); expect((await POST(request())).status).toBe(403); expect((await GET(request('GET'))).status).toBe(200);
  identity(); expect((await POST(request('POST', input, '', { origin: 'https://attacker.test' }))).status).toBe(403);
  expect((await POST(request('POST', input, '', { 'x-omegaos-workspace': B }))).status).toBe(409);
  auth.session.mockResolvedValue(null); expect((await GET(request('GET'))).status).toBe(401);
});
test('invalid/oversize input and secret payloads are never persisted or echoed', async () => {
  for (const body of [{ ...input, workspaceId: B }, { markdown: 'x'.repeat(40001) }, { markdown: 123 }]) {
    expect((await POST(request('POST', body))).status).toBe(400);
  }
  const value = 'sk-test-onlyFakeCredential123456';
  const response = await POST(request('POST', { markdown: `## Business overview\n${value}` }));
  expect(response.status).toBe(400);
  const text = await response.text(); expect(text).not.toContain(value); expect(JSON.parse(text).lines).toEqual([2]);
  expect(dbs.get(A)!.businessProfiles.current()).toBeNull();
});
test('lost membership during body read cannot save', async () => {
  auth.member.mockResolvedValueOnce({ role: 'member', organizationId: A, userId: 'user' }).mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(403);
  expect(dbs.get(A)!.businessProfiles.list()).toEqual([]);
});
test('malformed UTF-8 request bytes are rejected', async () => {
  const req = request(); const headers = req.headers;
  const bytes = Buffer.concat([Buffer.from('{"markdown":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}')]);
  expect((await POST(new Request(req.url, { method: 'POST', headers, body: bytes }))).status).toBe(400);
});
