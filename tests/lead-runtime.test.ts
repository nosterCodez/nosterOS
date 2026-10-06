import { afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), batch: vi.fn() }));
vi.mock('@/lib/workspace-jobs', () => ({ listWorkspaces: mocks.list }));
vi.mock('@/lib/leads/runner', () => ({ runLeadBatch: mocks.batch }));
import { runLeadTick } from '@/lib/leads/runtime';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('disabled runtime does not enumerate workspaces or call sources', async () => {
  vi.stubEnv('OMEGA_LEAD_ENGINE', '0'); expect(await runLeadTick()).toMatchObject({ skipped: 'private_beta' });
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
});
test('overlapping tick skips; offset is retained for next bounded batch', async () => {
  vi.stubEnv('OMEGA_LEAD_ENGINE', '1'); vi.stubEnv('OMEGA_LEAD_ENGINE_WORKSPACES', 'A'.repeat(32)); mocks.list.mockResolvedValue([]);
  let finish!: (result: unknown) => void; mocks.batch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = runLeadTick(); await vi.waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
  expect(await runLeadTick()).toMatchObject({ skipped: 'already_running' }); finish({ ran: 1, nextOffset: 2 }); await pending;
  mocks.batch.mockResolvedValueOnce({ ran: 0, nextOffset: 0 }); await runLeadTick(); expect(mocks.batch.mock.calls[1][0].offset).toBe(2);
});
