import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';

let db: FounderDb;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => db.close());
const point = (capturedAt: string, value: number) => ({ metricId: 'test.count', businessId: 'nostermarketing' as const, capturedAt, value });

test('upsert is idempotent, latest is honest, and day/week buckets use last UTC values', () => {
  expect(db.metricPoints.latest('test.count', 'nostermarketing')).toBeNull();
  const rows = [point('2026-10-04T09:00:00.000Z', 1), point('2026-10-04T20:00:00.000Z', 2), point('2026-10-05T09:00:00.000Z', 3)];
  db.metricPoints.upsert(rows);
  db.metricPoints.upsert(rows);
  expect(db.metricPoints.latest('test.count', 'nostermarketing')).toEqual({ capturedAt: rows[2].capturedAt, value: 3 });
  expect(db.metricPoints.series('test.count', 'nostermarketing', '2026-10-01T00:00:00.000Z', '2026-10-06T00:00:00.000Z', 'day')).toEqual([
    { bucket: '2026-10-04', value: 2 }, { bucket: '2026-10-05', value: 3 },
  ]);
  expect(db.metricPoints.series('test.count', 'nostermarketing', '2026-10-01T00:00:00.000Z', '2026-10-06T00:00:00.000Z', 'week')).toEqual([
    { bucket: '2026-09-28', value: 2 }, { bucket: '2026-10-05', value: 3 },
  ]);
});

test('an invalid batch writes nothing; parent cannot be stored', () => {
  expect(() => db.metricPoints.upsert([point('2026-10-01T00:00:00.000Z', 1), point('bad', 2)])).toThrow();
  expect(db.metricPoints.latest('test.count', 'nostermarketing')).toBeNull();
  expect(() => db.metricPoints.upsert([{ ...point('2026-10-01T00:00:00.000Z', 1), businessId: 'nostercodes' } as never])).toThrow();
});

test('collector run lifecycle retains last successful run after a failure', () => {
  const first = db.collectorRuns.start('test', new Date('2026-10-01T00:00:00Z'));
  db.collectorRuns.finish(first, { ok: true, pointsWritten: 2, error: null });
  const second = db.collectorRuns.start('test', new Date('2026-10-02T00:00:00Z'));
  db.collectorRuns.finish(second, { ok: false, pointsWritten: 0, error: 'failed' });
  expect(db.collectorRuns.last('test')).toMatchObject({ id: second, ok: false, error: 'failed' });
  expect(db.collectorRuns.lastOk('test')).toMatchObject({ id: first, ok: true, pointsWritten: 2 });
});
