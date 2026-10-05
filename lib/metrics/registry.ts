import type { BusinessId } from '@/lib/businesses';
import { CLOUD_SOURCES } from '@/lib/cloud-catalog';

export type MetricDef = {
  id: string;
  label: string;
  unit: 'count' | 'usd' | 'percent' | 'position' | 'seconds';
  source: string;
  businesses: BusinessId[];
  rollup: 'sum' | 'avg' | 'none';
  goodDirection: 'up' | 'down' | 'neutral';
};
export const METRICS: MetricDef[] = CLOUD_SOURCES.flatMap(source => source.metrics.map(metric => ({
  ...metric, id: `cloud.${source.id}.${metric.id}`, source: `cloud.${source.id}`, businesses: ['workspace'] as BusinessId[], rollup: 'none' as const, goodDirection: 'neutral' as const,
})));
export function getMetric(id: string): MetricDef | undefined {
  return METRICS.find(metric => metric.id === id);
}
