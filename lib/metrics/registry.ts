import type { BusinessId } from '@/lib/businesses';

export type MetricDef = {
  id: string;
  label: string;
  unit: 'count' | 'usd' | 'percent' | 'position' | 'seconds';
  source: string;
  businesses: BusinessId[];
  rollup: 'sum' | 'avg' | 'none';
  goodDirection: 'up' | 'down' | 'neutral';
};
export const METRICS: MetricDef[] = [];
export function getMetric(id: string): MetricDef | undefined {
  return METRICS.find(metric => metric.id === id);
}
