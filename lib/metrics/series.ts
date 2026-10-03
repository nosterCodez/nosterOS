import type { FounderDb } from '@/lib/db';
import { ROLLUP_ID } from '@/lib/businesses';
import type { MetricDef } from './registry';
import { rangeBuckets, type Bucket } from './buckets';

export function metricSeries(db: FounderDb, metric: MetricDef, business: string, from: string, to: string, bucket: Bucket) {
  if (business !== ROLLUP_ID) return db.metricPoints.series(metric.id, business, from, to, bucket);
  if (metric.rollup === 'none') throw new Error('This metric does not support a parent rollup');
  const series = metric.businesses.map(id => new Map(db.metricPoints.series(metric.id, id, from, to, bucket).map(p => [p.bucket, p.value])));
  return rangeBuckets(from, to, bucket).map(key => {
    const values = series.flatMap(points => points.has(key) ? [points.get(key)!] : []);
    const sum = values.reduce((total, value) => total + value, 0);
    return { bucket: key, value: values.length ? (metric.rollup === 'avg' ? sum / values.length : sum) : null, reporting: values.length, expected: metric.businesses.length };
  });
}
