import { archiveName } from '@/lib/backup/store';

/** Seven daily copies plus four older Sunday copies; prune only after upload verification. */
export function retainedArchives(names: string[]): Set<string> {
  const sorted = [...new Set(names)].sort().reverse();
  for (const name of sorted) {
    archiveName(name);
    const date = name.slice(8, 18);
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid backup date');
  }
  const keep = new Set<string>(); const dates = new Set<string>();
  for (const name of sorted) {
    const date = name.slice(8, 18);
    if (dates.has(date)) continue;
    dates.add(date); keep.add(name);
    if (keep.size === 7) break;
  }
  let weekly = 0;
  for (const name of sorted) {
    const date = name.slice(8, 18);
    if (dates.has(date) || new Date(`${date}T00:00:00Z`).getUTCDay() !== 0) continue;
    dates.add(date); keep.add(name);
    if (++weekly === 4) break;
  }
  return keep;
}
