import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { platformBackupStatus } from '@/lib/backup/status';
import PlatformPage from '@/app/settings/platform/page';
const state = vi.hoisted(() => ({ workspace: vi.fn(), summary: vi.fn(), operator: vi.fn(), gate: vi.fn() }));
vi.mock('@/lib/session', () => {
  class SessionError extends Error { constructor(message: string, public status = 401) { super(message); } }
  return { requireWorkspace: state.workspace, operatorWorkspaceForPage: state.gate, SessionError };
});
vi.mock('@/lib/operator-workspace', () => ({ operatorWorkspaceId: state.operator }));
vi.mock('@/lib/backup/repository', () => ({ readBackupSummary: state.summary }));
vi.mock('@/lib/leads/places-portal-job', () => ({ placesImportView: () => ({ current: { releaseDate: '2026-10-07', count: 1234, bytes: 2097152, attribution: 'Foursquare OS Places, Apache-2.0' }, last: null, running: false }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const owner = { role: 'owner', user: { email: 'owner@example.com' }, workspace: { id: 'operator', kind: 'agency' } };
const NON_OWNERS = [['admin', 'owner@example.com', 'operator'], ['owner', 'other@example.com', 'operator'], ['owner', 'owner@example.com', 'other']] as const;
function asOwner() {
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'owner@example.com'); state.operator.mockReturnValue('operator');
  state.workspace.mockResolvedValue(owner); state.summary.mockReturnValue(null);
}
const notFound = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ digest: expect.stringMatching(/404|NOT_FOUND/) });

test('only configured operator owner can read platform backup status', async () => {
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'owner@example.com'); state.operator.mockReturnValue('operator');
  for (const [role, email, id] of NON_OWNERS) {
    state.workspace.mockResolvedValue({ role, user: { email }, workspace: { id } });
    expect(await platformBackupStatus()).toBeNull();
  }
  expect(state.summary).not.toHaveBeenCalled();
  asOwner();
  expect(await platformBackupStatus()).toMatchObject({ stale: true, archiveCount: null });
});

test.each(['0', '1'])('platform owner sees only Backup status and the RGV import with NOSTEROS_OPERATOR_FEATURES=%s', async flag => {
  vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', flag); asOwner();
  const html = renderToStaticMarkup(await PlatformPage());
  expect(html.match(/<section /g)).toHaveLength(2);
  expect(html).toContain('Encrypted backups'); expect(html).toContain('No successful backup recorded'); expect(html).toContain('Unknown');
  expect(html).toContain('RGV places import'); expect(html).toContain('1,234 places'); expect(html).toContain('Replace RGV import');
  expect(html).not.toMatch(/OMEGA_BACKUP_KEY|OMEGA_FOURSQUARE_PLACES_TOKEN|Connect|connector/i);
  // The page does not depend on the operator-features gate.
  expect(state.gate).not.toHaveBeenCalled();
});

test.each(['0', '1'])('non-owners get a 404 before any backup read (flag %s)', async flag => {
  vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', flag); vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'owner@example.com'); state.operator.mockReturnValue('operator');
  for (const [role, email, id] of NON_OWNERS) {
    state.workspace.mockResolvedValue({ role, user: { email }, workspace: { id, kind: 'agency' } });
    await notFound(PlatformPage());
  }
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', ''); state.workspace.mockResolvedValue(owner);
  await notFound(PlatformPage());
  expect(state.summary).not.toHaveBeenCalled();
});
