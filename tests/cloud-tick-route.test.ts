import { afterEach, expect, test, vi } from 'vitest';
import { POST } from '@/app/api/cron/tick/route';
import { runCloudTick } from '@/lib/cloud-jobs';
import { runLeadTick } from '@/lib/leads/runtime';
import { apiSessionError } from '@/lib/session';
vi.mock('@/lib/cloud-jobs', () => ({ runCloudTick: vi.fn(async () => ({ ran: 2 })) }));
vi.mock('@/lib/leads/runtime', () => ({ runLeadTick: vi.fn(async () => ({ ran: 0 })) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('internal cloud tick preserves the instrumentation runner array contract', async () => {
  vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', '0'); vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'fixture-internal-secret');
  const result = await POST(new Request('http://localhost:4100/api/cron/tick', { method: 'POST', headers: { 'x-nosteros-internal': 'fixture-internal-secret' } }));
  expect(await result.json()).toEqual({ ran: [], cloud: { ran: 2 } }); expect(runCloudTick).toHaveBeenCalledOnce();
  expect(runLeadTick).toHaveBeenCalledOnce();
});
test('auth rejection prevents cloud tick execution', async () => {
  vi.mocked(apiSessionError).mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
  expect((await POST(new Request('http://localhost:4100/api/cron/tick', { method: 'POST' }))).status).toBe(401);
  expect(runCloudTick).not.toHaveBeenCalled();
  expect(runLeadTick).not.toHaveBeenCalled();
});
