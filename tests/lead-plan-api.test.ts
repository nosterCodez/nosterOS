import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { openSpendLedger } from '@/lib/spend/ledger';
import { GET, POST } from '@/app/api/leads/plan/route';
vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn(), ai: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: auth.session, getActiveMember: auth.member, getFullOrganization: auth.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: (id: string) => auth.open(id), withWorkspaceDb: (id: string, work: (db: unknown) => unknown) => work(auth.open(id)) }));
vi.mock('@/lib/ai/lead-ai', () => ({ runLeadAi: (...args: unknown[]) => auth.ai(...args) }));
const A = 'A'.repeat(32), B = 'B'.repeat(32);
let dbs: Map<string, ReturnType<typeof openDb>>, active = A;
function identity(id = A, role = 'member') {
  active = id;
  auth.session.mockResolvedValue({ user: { id: 'user', email: 'test@example.com', name: 'Test' }, session: { activeOrganizationId: id } });
  auth.member.mockResolvedValue({ role, organizationId: id, userId: 'user' });
  auth.organization.mockResolvedValue({ id, name: id, metadata: { kind: 'client' } });
}
function request(method = 'POST', body: unknown = { action: 'generate' }, extra: Record<string, string> = {}) {
  return new Request('http://localhost:4100/api/leads/plan', { method, headers: { cookie: 'better-auth.session_token=test', origin: 'http://localhost:4100', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...extra }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]); auth.open.mockImplementation((id: string) => dbs.get(id)); identity();
  dbs.get(A)!.businessProfiles.save('## Business overview\nExample\n## Service area\nEdinburg', 'user');
  auth.ai.mockResolvedValue({ value: null, generatedBy: 'rules', reason: 'no_provider', costUsd: 0 });
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('rules generation, skipped defaults, editing and owner activation stay in the workspace', async () => {
  const generated = await POST(request()); expect(generated.status).toBe(200);
  const initial = await generated.json(); expect(initial.latest.generatedBy).toBe('rules'); expect(initial.questions.length).toBeLessThanOrEqual(6);
  expect(initial.generation.costUsd).toBe(0);
  const answered = await (await POST(request('POST', { action: 'answer', id: initial.latest.id, skip: true, answers: {} }))).json();
  expect(answered.latest.plan.maxPaidLookupsPerWeek).toBe(0);
  const edited = await (await POST(request('POST', { action: 'edit', id: answered.latest.id, plan: { ...answered.latest.plan, tone: 'Friendly' } }))).json();
  expect((await POST(request('POST', { action: 'activate', id: edited.latest.id }))).status).toBe(403);
  identity(A, 'owner'); expect((await POST(request('POST', { action: 'activate', id: edited.latest.id }))).status).toBe(200);
  const state = await (await GET(request('GET'))).json(); expect(state.active.id).toBe(edited.latest.id);
  dbs.get(A)!.businessProfiles.save('## Business overview\nUpdated', 'user');
  expect((await (await GET(request('GET'))).json()).profileChanged).toBe(true);
  identity(B); expect((await (await GET(request('GET'))).json()).latest).toBeNull();
  dbs.get(B)!.businessProfiles.save('## Business overview\nOther workspace', 'user');
  expect((await POST(request('POST', { action: 'edit', id: edited.latest.id, plan: edited.latest.plan }))).status).toBe(404);
});
test('auth, role, origin, workspace and input guards reject unsafe requests', async () => {
  identity(A, 'viewer'); expect((await POST(request())).status).toBe(403); expect((await GET(request('GET'))).status).toBe(200);
  identity(); expect((await POST(request('POST', { action: 'generate' }, { origin: 'https://bad.test' }))).status).toBe(403);
  expect((await POST(request('POST', { action: 'generate' }, { 'x-omegaos-workspace': B }))).status).toBe(409);
  expect((await POST(request('POST', { action: 'generate', workspaceId: B }))).status).toBe(400);
  auth.session.mockResolvedValue(null); expect((await GET(request('GET'))).status).toBe(401);
});
test('generation refuses a missing profile and rechecks membership after the AI returns', async () => {
  identity(B); expect((await POST(request())).status).toBe(409); expect(auth.ai).not.toHaveBeenCalled();
  identity(); auth.ai.mockImplementation(async () => { auth.member.mockResolvedValue(null); return { value: null, generatedBy: 'rules', costUsd: 0 }; });
  expect((await POST(request())).status).toBe(403); expect(dbs.get(A)!.leadPlans.latest()).toBeNull();
});
test('profile changes during generation discard the outdated result', async () => {
  auth.ai.mockImplementation(async () => { dbs.get(A)!.businessProfiles.save('## Business overview\nChanged', 'user'); return { value: null, generatedBy: 'rules', costUsd: 0 }; });
  expect((await POST(request())).status).toBe(409); expect(dbs.get(A)!.leadPlans.latest()).toBeNull();
});

test('non-operator workspace with an empty vault cannot use host AI keys or write spend', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'host-openai-must-not-be-used');
  vi.stubEnv('ANTHROPIC_API_KEY', 'host-anthropic-must-not-be-used');
  identity(B, 'owner');
  dbs.get(B)!.businessProfiles.save('## Business overview\nClient fixture\n## Service area\nEdinburg', 'user');
  expect(dbs.get(B)!.connectionRecords.all()).toEqual([]);
  const ledger = openSpendLedger(':memory:');
  const provider = vi.fn(() => { throw new Error('Host credentials reached provider'); });
  vi.stubGlobal('fetch', provider);
  try {
    const real = await vi.importActual<typeof import('@/lib/ai/lead-ai')>('@/lib/ai/lead-ai');
    auth.ai.mockImplementation((ctx, input) => real.runLeadAi(ctx, input, ledger));
    const response = await POST(request());
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state.latest.generatedBy).toBe('rules');
    expect(state.generation.costUsd).toBe(0);
    expect(provider).not.toHaveBeenCalled();
    expect(ledger.forWorkspace(B).rows()).toEqual([]);
    expect(ledger.forWorkspace(A).rows()).toEqual([]);
  } finally { ledger.close(); vi.unstubAllGlobals(); }
});
