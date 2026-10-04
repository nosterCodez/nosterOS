import { z } from 'zod';
import type { ForeplayClient } from '@/lib/foreplay/client';
import { adStore } from '@/lib/foreplay/store';

/**
 * The local watchlist: Adscout's own curated brand list, independent of
 * Foreplay's Spyder (whose tracking can only be edited inside their app).
 * Brands are added by domain (resolved through the API once) or directly by
 * brand id from a mine result, and monitored via the public brand endpoints,
 * which work for ANY brand. This is what makes the whole loop hands-off.
 */

export const WatchEntrySchema = z.object({
  id: z.string().min(1), // Foreplay brand id
  name: z.string().min(1),
  domain: z.string().optional(),
  avatar: z.string().nullable().optional(),
  addedAt: z.string(),
});
export type WatchEntry = z.infer<typeof WatchEntrySchema>;

export function readWatchEntries(workspaceId: string): WatchEntry[] {
  const raw = adStore(workspaceId).readWatchlist() as unknown[];
  const out: WatchEntry[] = [];
  for (const row of raw) {
    const parsed = WatchEntrySchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function writeWatchEntries(workspaceId: string, entries: WatchEntry[]): void {
  adStore(workspaceId).writeWatchlist(entries as never[]);
}

export function removeWatchEntry(workspaceId: string, brandId: string): WatchEntry[] {
  const next = readWatchEntries(workspaceId).filter((e) => e.id !== brandId);
  writeWatchEntries(workspaceId, next);
  return next;
}

/** Add by brand id (already known, e.g. from a mine result): no API call. */
export function addWatchEntry(workspaceId: string, entry: Omit<WatchEntry, 'addedAt'>): WatchEntry[] {
  const list = readWatchEntries(workspaceId);
  if (list.some((e) => e.id === entry.id)) return list;
  const next = [...list, { ...entry, addedAt: new Date().toISOString() }];
  writeWatchEntries(workspaceId, next);
  return next;
}

/** Add by domain: resolves to the biggest brand profile via one API call. */
export async function addWatchDomain(workspaceId: string, client: ForeplayClient, domain: string): Promise<WatchEntry | null> {
  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const pages = await client.brandsByDomain(clean);
  if (pages.length === 0) return null;
  const best = [...pages].sort((a, b) => (b.ads_count ?? 0) - (a.ads_count ?? 0))[0];
  const entry: WatchEntry = {
    id: best.id,
    name: best.name,
    domain: clean,
    avatar: best.avatar ?? null,
    addedAt: new Date().toISOString(),
  };
  addWatchEntry(workspaceId, entry);
  return entry;
}
