import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { platformBackupStatus } from '@/lib/backup/status';
import PlatformPage from '@/app/settings/platform/page';
const state = vi.hoisted(() => ({ workspace: vi.fn(), summary: vi.fn(), operator: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireWorkspace: state.workspace }));
vi.mock('@/lib/operator-workspace', () => ({ operatorWorkspaceId: state.operator }));
vi.mock('@/lib/backup/repository', () => ({ readBackupSummary: state.summary }));
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
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'owner@example.com'); state.operator.mockReturnValue('operator');
  state.workspace.mockResolvedValue({ role: 'owner', user: { email: 'owner@example.com' }, workspace: { id: 'operator' } });
  state.summary.mockReturnValue(null);
  const html = renderToStaticMarkup(await PlatformPage());
  expect(html).toContain('No successful backup recorded'); expect(html).toContain('Unknown');
  expect(html).not.toContain('OMEGA_BACKUP_KEY');
});
