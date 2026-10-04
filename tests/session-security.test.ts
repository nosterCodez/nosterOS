import { afterEach, expect, test, vi } from 'vitest';
vi.unmock('@/lib/session');
const getSession = vi.hoisted(() => vi.fn());
const getActiveMember = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession, getActiveMember, getFullOrganization: async () => ({ id: 'workspace', name: 'Test', metadata: { kind: 'client' } }) } }) }));
import { apiSessionError } from '@/lib/session';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function request(method = 'GET', cookie = 'better-auth.session_token=forged') {
  return new Request('http://localhost:4100/api/agents', { method, headers: { cookie, origin: 'http://localhost:4100' } });
}
test('forged cookie is rejected by server-side session validation', async () => {
  vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); getSession.mockResolvedValue(null);
  expect((await apiSessionError('/api/agents', 'GET', request()))?.status).toBe(401);
});
test('viewer writes are forbidden; authorized reads work', async () => {
  vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  getSession.mockResolvedValue({ user: { id: 'user' }, session: { activeOrganizationId: 'workspace' } });
  getActiveMember.mockResolvedValue({ role: 'viewer', organizationId: 'workspace', userId: 'user' });
  expect((await apiSessionError('/api/agents', 'POST', request('POST')))?.status).toBe(403);
  expect(await apiSessionError('/api/agents', 'GET', request())).toBeNull();
});
test('internal request needs both configured secrets and an allowed path', async () => {
  vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', 'outer'); vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'inner');
  const req = new Request('http://localhost:4100/api/cron/tick', { method: 'POST', headers: { cookie: 'founder_os_access=outer', 'x-nosteros-internal': 'inner' } });
  expect(await apiSessionError('/api/cron/tick', 'POST', req)).toBeNull();
  expect((await apiSessionError('/api/agents', 'POST', req))?.status).toBe(401);
});
test('cross-origin mutation is rejected even with a valid session', async () => {
  vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  getSession.mockResolvedValue({ user: { id: 'user' }, session: { activeOrganizationId: 'workspace' } }); getActiveMember.mockResolvedValue({ role: 'owner', organizationId: 'workspace', userId: 'user' });
  const req = request('POST'); req.headers.set('origin', 'https://attacker.example');
  expect((await apiSessionError('/api/agents', 'POST', req))?.status).toBe(403);
});
