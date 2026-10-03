import type { BusinessId } from '@/lib/businesses';
import type { ConnectorStatus } from '@/lib/connectors/types';

export type Point = { metricId: string; businessId: BusinessId; capturedAt: string; value: number };
export type CollectResult = { points: Point[]; note?: string };
export interface Collector {
  id: string;
  name: string;
  everyMinutes: number;
  status(): Promise<ConnectorStatus>;
  collect(ctx: { now: Date; lastOkAt: string | null }): Promise<CollectResult>;
}
