import { expect, test } from 'vitest';
import { METRICS, getMetric } from '@/lib/metrics/registry';
import { BUSINESSES, ROLLUP_ID } from '@/lib/businesses';

test('metric ids and businesses are unique and parent is never stored', () => {
  expect(new Set(METRICS.map(m => m.id)).size).toBe(METRICS.length);
  expect(new Set(BUSINESSES.map(b => b.id)).size).toBe(BUSINESSES.length);
  expect(BUSINESSES.some(b => String(b.id) === ROLLUP_ID)).toBe(false);
  expect(getMetric('missing')).toBeUndefined();
  for (const metric of METRICS) expect(getMetric(metric.id)).toBe(metric);
});
