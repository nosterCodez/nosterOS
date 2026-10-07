import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.unmock('@/lib/session');
const auth = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), operator: vi.fn(), start: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: auth.session, getActiveMember: auth.member, getFullOrganization: auth.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: vi.fn(), withWorkspaceDb: vi.fn() }));
vi.mock('@/lib/operator-workspace', () => ({ operatorWorkspaceId: auth.operator }));
vi.mock('@/lib/leads/places-portal-job', () => ({ startPlacesImport: auth.start, placesImportView: auth.view }));
import { GET, POST } from '@/app/api/platform/places-import/route';

const OP = 'O'.repeat(32), OTHER = 'X'.repeat(32);
let active = OP, dataRoot = '';
function identity(id = OP, role = 'owner', email = 'owner@example.com') {
  active = id; auth.session.mockResolvedValue({ user: { id: 'user', email, name: 'Owner' }, session: { activeOrganizationId: id } });
  auth.member.mockResolvedValue({ role, organizationId: id, userId: 'user' }); auth.organization.mockResolvedValue({ id, name: id, metadata: { kind: 'agency' } });
}
function req(method = 'POST', body: unknown = { action: 'import', replace: false }, headers = {}) {
  return new Request('http://localhost:4100/api/platform/places-import', { method, headers: { origin: 'http://localhost:4100', cookie: 'better-auth.session_token=fixture', 'content-type': 'application/json', 'x-omegaos-workspace': active, ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-places-api-'));
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ''); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', ''); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'owner@example.com'); vi.stubEnv('DATA_DIR', dataRoot);
  auth.operator.mockReturnValue(OP); auth.view.mockReturnValue({ current: null, last: null, running: false }); auth.start.mockReturnValue({ ok: true });
  identity();
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

test('platform owner can read status and start an import; the request picks replace explicitly', async () => {
  expect((await GET(req('GET'))).status).toBe(200);
  expect((await POST(req())).status).toBe(202);
  expect(auth.start).toHaveBeenCalledWith({ dataRoot: expect.any(String), replace: false });
  expect((await POST(req('POST', { action: 'import', replace: true }))).status).toBe(202);
  expect(auth.start).toHaveBeenLastCalledWith({ dataRoot: expect.any(String), replace: true });
});

test.each([
  ['admin of the operator workspace', () => identity(OP, 'admin')],
  ['owner with another email', () => identity(OP, 'owner', 'someone@example.com')],
  ['owner of another workspace', () => identity(OTHER, 'owner')],
  ['viewer', () => identity(OP, 'viewer')],
])('403 for %s, and nothing starts', async (_name, setup) => {
  setup();
  expect((await POST(req())).status).toBe(403);
  expect([401, 403]).toContain((await GET(req('GET'))).status);
  expect(auth.start).not.toHaveBeenCalled();
});

test('no owner email configured means nobody is platform owner', async () => {
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', '');
  expect((await POST(req())).status).toBe(403); expect(auth.start).not.toHaveBeenCalled();
});

test('busy lock and unconfirmed replacement return 409; bad origin, workspace switch and extra fields are refused', async () => {
  auth.start.mockReturnValueOnce({ ok: false, reason: 'busy' });
  const busy = await POST(req()); expect(busy.status).toBe(409); expect((await busy.json()).error).toMatch(/already running/);
  auth.start.mockReturnValueOnce({ ok: false, reason: 'exists' });
  const exists = await POST(req()); expect(exists.status).toBe(409); expect((await exists.json()).error).toMatch(/Confirm replacement/);
  auth.start.mockClear();
  expect((await POST(req('POST', { action: 'import', replace: false }, { origin: 'https://bad.test' }))).status).toBe(403);
  expect((await POST(req('POST', { action: 'import', replace: false }, { 'x-omegaos-workspace': OTHER }))).status).toBe(409);
  expect((await POST(req('POST', { action: 'import', replace: false, token: 'x' }))).status).toBe(400);
  expect((await POST(req('POST', { action: 'import' }))).status).toBe(400);
  auth.session.mockResolvedValue(null); expect((await POST(req())).status).toBe(401);
  expect(auth.start).not.toHaveBeenCalled();
});
