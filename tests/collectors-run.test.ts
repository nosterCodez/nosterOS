import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { METRICS } from '@/lib/metrics/registry';
import { runCollector, dueCollectors, collectorHealth } from '@/lib/collectors/run';
import { registerCollectors } from '@/lib/collectors/index';
import type { Collector, Point } from '@/lib/collectors/types';

let db: FounderDb;
const now = new Date('2026-10-03T12:00:00.000Z');
const point: Point = { metricId: 'test.count', businessId: 'nostermarketing', capturedAt: now.toISOString(), value: 4 };
const fake = (): Collector => ({ id: 'test', name: 'Test', everyMinutes: 15,
  status: async () => ({ id: 'test', name: 'Test', kind: 'local', state: 'connected', detail: 'test only' }),
  collect: async () => ({ points: [point] }),
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  db = openDb(':memory:');
  METRICS.push({ id: point.metricId, label: 'Test', unit: 'count', source: 'test', businesses: ['nostermarketing'], rollup: 'sum', goodDirection: 'up' });
});
afterEach(() => { METRICS.pop(); db.close(); vi.useRealTimers(); });

test('fixed intervals catch up once, pass lastOkAt and expose staleness', async () => {
  const c = fake();
  expect(collectorHealth(c, db, now)).toMatchObject({ stale: true, neverSucceeded: true, lastOkAt: null });
  expect(dueCollectors([c], db, now)).toEqual([c]);
  expect(await runCollector(c, db, now)).toMatchObject({ ok: true, pointsWritten: 1 });
  expect(dueCollectors([c], db, now)).toEqual([]);
  expect(dueCollectors([c], db, new Date(+now + 15 * 60_000))).toEqual([c]);
  expect(dueCollectors([c], db, new Date(+now + 20 * 86400_000))).toEqual([c]);
  expect(collectorHealth(c, db, new Date(+now + 30 * 60_000))).toMatchObject({ stale: false, neverSucceeded: false });
  expect(collectorHealth(c, db, new Date(+now + 30 * 60_000 + 1))).toMatchObject({ stale: true });
  c.collect = vi.fn().mockResolvedValue({ points: [] });
  await runCollector(c, db, new Date(+now + 15 * 60_000));
  expect(c.collect).toHaveBeenCalledWith({ now: new Date(+now + 15 * 60_000), lastOkAt: now.toISOString() });
});

test.each([0, 14, 10081, NaN, Infinity])('rejects invalid interval %s at registration', everyMinutes => {
  expect(() => registerCollectors([{ ...fake(), everyMinutes }])).toThrow(/interval/);
});
test('valid boundary intervals register and duplicate ids fail', () => {
  expect(registerCollectors([{ ...fake(), everyMinutes: 10080 }])).toHaveLength(1);
  expect(() => registerCollectors([fake(), fake()])).toThrow(/Duplicate/);
});
test.each([
  { metricId: 'unknown' }, { businessId: 'nosterhealth' }, { value: NaN }, { capturedAt: 'yesterday' },
])('rejects the whole invalid batch and records its point index: %j', async invalid => {
  const c = fake();
  c.collect = async () => ({ points: [point, { ...point, ...invalid } as Point] });
  expect(await runCollector(c, db, now)).toMatchObject({ ok: false, pointsWritten: 0, error: expect.stringContaining('point 1') });
  expect(db.metricPoints.latest(point.metricId, point.businessId)).toBeNull();
});
test('wrong source is rejected', async () => {
  METRICS[METRICS.length - 1].source = 'other';
  expect(await runCollector(fake(), db, now)).toMatchObject({ ok: false, error: expect.stringContaining('source') });
});
test('throwing and unconfigured collectors keep earlier points and record failure', async () => {
  const c = fake(); await runCollector(c, db, now);
  c.collect = async () => { throw new Error('offline'); };
  expect(await runCollector(c, db, new Date(+now + 900000))).toMatchObject({ ok: false, error: 'offline' });
  expect(db.metricPoints.latest(point.metricId, point.businessId)?.value).toBe(4);
  c.status = async () => ({ id: 'test', name: 'Test', kind: 'local', state: 'not_configured', detail: '' });
  expect(await runCollector(c, db, new Date(+now + 1800000))).toMatchObject({ ok: false, error: 'not configured' });
});
