import type { FounderDb } from '@/lib/db';
import { MetricPointSchema } from '@/lib/schemas';
import { getMetric } from '@/lib/metrics/registry';
import type { Collector } from './types';

export async function runCollector(collector: Collector, db: FounderDb, now: Date) {
  const lastOkAt = db.collectorRuns.lastOk(collector.id)?.startedAt ?? null;
  const id = db.collectorRuns.start(collector.id, now);
  let result: { ok: boolean; pointsWritten: number; error: string | null } = { ok: false, pointsWritten: 0, error: null };
  try {
    if ((await collector.status()).state !== 'connected') {
      result.error = 'not configured';
    } else {
      const batch = await collector.collect({ now, lastOkAt });
      const points = batch.points.map((input, index) => {
        try {
          const point = MetricPointSchema.parse(input);
          const metric = getMetric(point.metricId);
          if (!metric) throw new Error(`Unknown metric ${point.metricId}`);
          if (metric.source !== collector.id) throw new Error(`Wrong source for ${point.metricId}`);
          if (!metric.businesses.includes(point.businessId)) throw new Error(`Disallowed business for ${point.metricId}`);
          return point;
        } catch (error) {
          throw new Error(`Invalid point ${index}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      db.metricPoints.upsert(points);
      result = { ok: true, pointsWritten: points.length, error: null };
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  db.collectorRuns.finish(id, result);
  return { id, ...result };
}

export function dueCollectors(collectors: Collector[], db: FounderDb, now: Date): Collector[] {
  return collectors.filter(collector => {
    const last = db.collectorRuns.last(collector.id);
    return !last || +now - Date.parse(last.startedAt) >= collector.everyMinutes * 60_000;
  });
}

export function collectorHealth(collector: Collector, db: FounderDb, now: Date) {
  const lastRun = db.collectorRuns.last(collector.id);
  const lastOkRun = db.collectorRuns.lastOk(collector.id);
  const lastOkAt = lastOkRun?.startedAt ?? null;
  return { lastRun, lastOkRun, lastOkAt, neverSucceeded: !lastOkRun, stale: !lastOkAt || +now - Date.parse(lastOkAt) > 2 * collector.everyMinutes * 60_000 };
}
