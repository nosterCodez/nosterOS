import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { platformBackupStatus } from '@/lib/backup/status';
import PlatformPage from '@/app/settings/platform/page';
const state = vi.hoisted(() => ({ workspace: vi.fn(), summary: vi.fn(), operator: vi.fn(), gate: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireWorkspace: state.workspace, operatorWorkspaceForPage: state.gate }));
vi.mock('@/lib/operator-workspace', () => ({ operatorWorkspaceId: state.operator }));
vi.mock('@/lib/backup/repository', () => ({ readBackupSummary: state.summary }));
vi.mock('@/lib/leads/places-portal-job', () => ({ placesImportView: () => ({ current: { releaseDate: '2026-10-07', count: 1234, bytes: 2097152, attribution: 'Foursquare OS Places, Apache-2.0' }, last: null, running: false }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('only configured operator owner can read platform backup status', async () => {
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'owner@example.com'); state.operator.mockReturnValue('operator');
  for (const [role, email, id] of [['admin', 'owner@example.com', 'operator'], ['owner', 'other@example.com', 'operator'], ['owner', 'owner@example.com', 'other']]) {
    state.workspace.mockResolvedValue({ role, user: { email }, workspace: { id } });
    expect(await platformBackupStatus()).toBeNull();
  }
  expect(state.summary).not.toHaveBeenCalled();
  state.workspace.mockResolvedValue({ role: 'owner', user: { email: 'owner@example.com' }, workspace: { id: 'operator' } });
  state.summary.mockReturnValue(null);
  expect(await platformBackupStatus()).toMatchObject({ stale: true, archiveCount: null });
});
test('owner panel shows honest missing state and no backup secrets', async () => {
  state.gate.mockResolvedValue({ workspace: { id: 'operator' } });
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'owner@example.com'); state.operator.mockReturnValue('operator');
  state.workspace.mockResolvedValue({ role: 'owner', user: { email: 'owner@example.com' }, workspace: { id: 'operator' } });
  state.summary.mockReturnValue(null);
  const html = renderToStaticMarkup(await PlatformPage());
  expect(html).toContain('No successful backup recorded'); expect(html).toContain('Unknown');
  expect(html).not.toContain('OMEGA_BACKUP_KEY');
  expect(html).toContain('RGV places import'); expect(html).toContain('1,234 places'); expect(html).toContain('Replace RGV import');
  expect(html).not.toContain('OMEGA_FOURSQUARE_PLACES_TOKEN');
});
test('disabled operator gate returns unavailable before any backup owner or database read', async () => {
  state.gate.mockResolvedValue(null);
  const result = await PlatformPage();
  expect(result.type.name).toBe('OperatorUnavailable');
  expect(state.workspace).not.toHaveBeenCalled();
  expect(state.summary).not.toHaveBeenCalled();
});
