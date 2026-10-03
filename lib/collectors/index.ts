import type { Collector } from './types';

export function registerCollectors(collectors: Collector[]): Collector[] {
  const ids = new Set<string>();
  for (const collector of collectors) {
    if (!Number.isFinite(collector.everyMinutes) || collector.everyMinutes < 15 || collector.everyMinutes > 10080) {
      throw new Error(`Invalid collector interval: ${collector.id}`);
    }
    if (ids.has(collector.id)) throw new Error(`Duplicate collector id: ${collector.id}`);
    ids.add(collector.id);
  }
  return collectors;
}
export const COLLECTORS: Collector[] = registerCollectors([]);
