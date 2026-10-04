import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { storeDir } from '@/lib/foreplay/store';
import type { WallAd } from '@/lib/foreplay/wall';

/**
 * Saved ads: the operator's curated swipe file inside AdPilot. Each save keeps a
 * full WallAd snapshot (Foreplay CDN URLs are stable, and a saved ad must
 * survive the source brand leaving the watchlist). Saves are one of the two
 * legitimate manual affordances (with the watchlist): everything else is
 * ingestion-owned. Saves also teach the For-you feed (lib/foreplay/personal).
 */

const SavedAdSchema = z.object({
  ad: z.record(z.string(), z.unknown()), // WallAd snapshot: validated at save time by the route
  savedAt: z.string(),
});
export type SavedAd = { ad: WallAd; savedAt: string };

const CAP = 200;

function savedPath(workspaceId: string): string {
  return path.join(storeDir(workspaceId), 'saved.json');
}

export function readSavedAds(workspaceId: string): SavedAd[] {
  const file = savedPath(workspaceId);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[];
    return raw.filter((r) => SavedAdSchema.safeParse(r).success) as SavedAd[];
  } catch {
    return [];
  }
}

function writeSavedAds(workspaceId: string, saved: SavedAd[]): void {
  fs.mkdirSync(storeDir(workspaceId), { recursive: true });
  fs.writeFileSync(savedPath(workspaceId), JSON.stringify(saved.slice(0, CAP), null, 2) + '\n');
}

export function saveAd(workspaceId: string, ad: WallAd): SavedAd[] {
  const saved = readSavedAds(workspaceId);
  if (saved.some((s) => s.ad.id === ad.id)) return saved;
  const next = [{ ad, savedAt: new Date().toISOString() }, ...saved];
  writeSavedAds(workspaceId, next);
  return next;
}

export function unsaveAd(workspaceId: string, adId: string): SavedAd[] {
  const next = readSavedAds(workspaceId).filter((s) => s.ad.id !== adId);
  writeSavedAds(workspaceId, next);
  return next;
}
