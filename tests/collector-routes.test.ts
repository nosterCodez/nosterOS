import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { COLLECTORS } from '@/lib/collectors';
import { METRICS } from '@/lib/metrics/registry';
import { GET as list } from '@/app/api/collectors/route';
import { GET as points } from '@/app/api/metrics/points/route';
import { POST as tick } from '@/app/api/cron/tick/route';

let db: FounderDb;
vi.mock('@/lib/data', () => ({ getDb: () => db }));
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); COLLECTORS.splice(0); METRICS.splice(0); });
const query = (over: Record<string, string> = {}) => new Request('http://localhost/api/metrics/points?' + new URLSearchParams({ metric: 'test.count', business: 'nostercodes', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z', bucket: 'day', ...over }));

test('empty registry returns []; tick runs registered collectors once without agent jobs', async () => {
  expect(await (await list()).json()).toEqual([]);
  METRICS.push({ id: 'test.count', label: 'Test', source: 'test', unit: 'count', businesses: ['nostermarketing'], rollup: 'sum', goodDirection: 'up' });
  COLLECTORS.push({ id: 'test', name: 'Test', everyMinutes: 15,
    status: async () => ({ id: 'test', name: 'Test', kind: 'local', state: 'connected', detail: '' }),
    collect: async ({ now }) => ({ points: [{ metricId: 'test.count', businessId: 'nostermarketing', capturedAt: now.toISOString(), value: 0 }] }),
  });
  expect(await (await list()).json()).toEqual([expect.objectContaining({ everyMinutes: 15, lastOkAt: null, stale: true, neverSucceeded: true })]);
  expect(await (await tick()).json()).toMatchObject({ ran: [{ cronId: 'collector:test', ok: true }], due: 1 });
  expect(await (await tick()).json()).toMatchObject({ ran: [], due: 0 });
  expect(await (await list()).json()).toEqual([expect.objectContaining({ stale: false, neverSucceeded: false })]);
});

test('series route validates inputs and rejects unsupported rollups', async () => {
  expect((await points(query())).status).toBe(400);
  METRICS.push({ id: 'test.count', label: 'Test', source: 'test', unit: 'count', businesses: ['nostermarketing'], rollup: 'sum', goodDirection: 'up' });
  expect(await (await points(query())).json()).toEqual([
    { bucket: '2026-10-01', value: null, reporting: 0, expected: 1 },
    { bucket: '2026-10-02', value: null, reporting: 0, expected: 1 },
  ]);
  expect((await points(query({ bucket: 'month' }))).status).toBe(400);
  expect((await points(query({ from: 'bad' }))).status).toBe(400);
  expect((await points(query({ from: '2027-01-01T00:00:00Z' }))).status).toBe(400);
  expect((await points(query({ business: 'unknown' }))).status).toBe(400);
  METRICS[0].rollup = 'none';
  const res = await points(query());
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/rollup/);
});
