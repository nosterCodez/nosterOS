import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { rulesPlan } from '@/lib/leads/plan';
import { GET, POST } from '@/app/api/leads/runs/route';
vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: auth.session, getActiveMember: auth.member, getFullOrganization: auth.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: (id: string) => auth.open(id), withWorkspaceDb: (id: string, work: (db: unknown) => unknown) => work(auth.open(id)) }));
const A = 'A'.repeat(32), B = 'B'.repeat(32);
let dbs: Map<string, ReturnType<typeof openDb>>, active = A;
function identity(id = A, role = 'owner') {
  active = id; auth.session.mockResolvedValue({ user: { id: 'user' }, session: { activeOrganizationId: id } });
  auth.member.mockResolvedValue({ role, organizationId: id, userId: 'user' }); auth.organization.mockResolvedValue({ id, name: id, metadata: { kind: 'client' } });
}
function req(method = 'POST', body = { action: 'run' }, headers = {}) {
  return new Request('http://localhost:4100/api/leads/runs', { method, headers: { origin: 'http://localhost:4100', cookie: 'better-auth.session_token=fixture', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_LEAD_ENGINE', '1'); vi.stubEnv('OMEGA_LEAD_ENGINE_WORKSPACES', A);
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]); auth.open.mockImplementation(id => dbs.get(id)); identity();
  const db = dbs.get(A)!; db.businessProfiles.save('## Business overview\nTest\n## Service area\nMission', 'user');
  const profile = db.businessProfiles.current()!, draft = db.leadPlans.saveDraft({ plan: rulesPlan(profile), generatedBy: 'rules', profileVersion: profile.version });
  db.leadPlans.activate(draft.id, { id: 'user', role: 'owner' }, profile.version);
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('Run now queues only, caps three per day and never exposes another workspace', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try {
    for (let i = 0; i < 3; i++) expect((await POST(req())).status).toBe(202);
    expect((await POST(req())).status).toBe(429); expect(fetch).not.toHaveBeenCalled();
    identity(B); const body = await (await GET(req('GET'))).json(); expect(body.runs).toEqual([]); expect(body.enabled).toBe(false);
    expect((await POST(req())).status).toBe(403);
  } finally { vi.unstubAllGlobals(); }
});
test('viewer/member, origin, workspace switch, stale profile and disabled flags are enforced', async () => {
  identity(A, 'viewer'); expect((await GET(req('GET'))).status).toBe(200); expect((await POST(req())).status).toBe(403);
  identity(A, 'member'); expect((await POST(req())).status).toBe(403);
  identity(); expect((await POST(req('POST', { action: 'run' }, { origin: 'https://bad.test' }))).status).toBe(403);
  expect((await POST(req('POST', { action: 'run' }, { 'x-omegaos-workspace': B }))).status).toBe(409);
  vi.stubEnv('OMEGA_LEAD_ENGINE', '0'); expect((await POST(req())).status).toBe(403); vi.stubEnv('OMEGA_LEAD_ENGINE', '1');
  dbs.get(A)!.businessProfiles.save('## Business overview\nChanged', 'user'); expect((await POST(req())).status).toBe(409);
  auth.session.mockResolvedValue(null); expect((await GET(req('GET'))).status).toBe(401);
});
