import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { financialImportRequest } from '@/lib/financial-import-api';
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
const input = { action: 'save', format: 'standard', account: 'checking', csv: 'id,date,description,amount,currency\na,2026-10-01,Sale,100,USD' };
function call(method = 'POST', body: unknown = input, extra: Record<string, string> = {}) {
  return financialImportRequest(new Request('http://localhost:4100/api/finances/imports', { method, headers: { cookie: 'better-auth.session_token=test', origin: 'http://localhost:4100', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...extra }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
}
beforeEach(() => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]); auth.open.mockImplementation((id: string) => dbs.get(id)); identity();
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('preview does not persist; confirmation persists and repeated upload deduplicates', async () => {
  const preview = await (await call('POST', { ...input, action: 'preview' })).json();
  expect(preview.count).toBe(1); expect(dbs.get(A)!.financialImports.summary()).toEqual([]);
  expect(await (await call()).json()).toMatchObject({ inserted: 1, duplicates: 0 });
  expect(await (await call()).json()).toMatchObject({ inserted: 0, duplicates: 1 });
  identity(B); expect(await (await call('GET')).json()).toEqual({ summaries: [] });
  expect((await call('POST', input, { 'x-omegaos-workspace': A })).status).toBe(409);
  expect(dbs.get(B)!.financialImports.summary()).toEqual([]);
});
test('viewer/member cannot import; viewer can read only its workspace', async () => {
  for (const role of ['viewer', 'member']) { identity(A, role); expect((await call()).status).toBe(403); }
  identity(A, 'viewer'); expect((await call('GET')).status).toBe(200);
  auth.session.mockResolvedValue(null); expect((await call()).status).toBe(401);
});
test('origin, body limits, unknown fields and malformed rows fail closed', async () => {
  expect((await call('POST', input, { origin: 'https://attacker.test' })).status).toBe(403);
  expect((await call('POST', { ...input, workspaceId: B })).status).toBe(400);
  expect((await call('POST', { ...input, csv: 'x'.repeat(1_100_000) })).status).toBe(400);
  expect((await call('POST', { ...input, csv: input.csv + '\nb,invalid,Sale,100,USD' })).status).toBe(400);
  expect(dbs.get(A)!.financialImports.summary()).toEqual([]);
});
test('membership lost while reading upload prevents persistence', async () => {
  auth.member.mockResolvedValueOnce({ role: 'owner', organizationId: A, userId: 'user' }).mockResolvedValueOnce(null);
  expect((await call()).status).toBe(403);
  expect(dbs.get(A)!.financialImports.summary()).toEqual([]);
});
