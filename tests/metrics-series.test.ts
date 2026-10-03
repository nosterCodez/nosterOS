import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { metricSeries } from '@/lib/metrics/series';
import type { MetricDef } from '@/lib/metrics/registry';

let db: FounderDb;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => db.close());
const metric: MetricDef = { id: 'test.count', label: 'Test', unit: 'count', source: 'test', businesses: ['nostermarketing', 'nosterhealth'], rollup: 'sum', goodDirection: 'up' };
const from = '2026-10-01T00:00:00.000Z';
const to = '2026-10-03T23:59:59.999Z';
test('rollups expose complete, partial and zero reporting without inventing zeros', () => {
  db.metricPoints.upsert([
    { metricId: metric.id, businessId: 'nostermarketing', capturedAt: from, value: 2 },
    { metricId: metric.id, businessId: 'nosterhealth', capturedAt: from, value: 4 },
    { metricId: metric.id, businessId: 'nostermarketing', capturedAt: '2026-10-02T12:00:00.000Z', value: 0 },
  ]);
  expect(metricSeries(db, metric, 'nostercodes', from, to, 'day')).toEqual([
    { bucket: '2026-10-01', value: 6, reporting: 2, expected: 2 },
    { bucket: '2026-10-02', value: 0, reporting: 1, expected: 2 },
    { bucket: '2026-10-03', value: null, reporting: 0, expected: 2 },
  ]);
  expect(metricSeries(db, { ...metric, rollup: 'avg' }, 'nostercodes', from, to, 'day')[0].value).toBe(3);
  expect(metricSeries(db, metric, 'nosterhealth', from, to, 'day')).toEqual([{ bucket: '2026-10-01', value: 4 }]);
  expect(() => metricSeries(db, { ...metric, rollup: 'none' }, 'nostercodes', from, to, 'day')).toThrow(/rollup/);
});
