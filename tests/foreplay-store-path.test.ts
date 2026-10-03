import { afterEach, expect, test, vi } from 'vitest';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { adStore, storeDir } from '@/lib/foreplay/store';
import { addWatchEntry, readWatchEntries } from '@/lib/foreplay/watchlist';
import { saveAd, readSavedAds } from '@/lib/foreplay/saved';
import { toWallAd } from '@/lib/foreplay/wall';

const A = 'A'.repeat(32), B = 'B'.repeat(32);
let root: string;
afterEach(() => { vi.unstubAllEnvs(); if (root) rmSync(root, { recursive: true, force: true }); });
test('ad storage is always workspace scoped and rejects traversal', () => {
  vi.stubEnv('DATA_DIR', path.join(process.cwd(), 'test-volume'));
  vi.stubEnv('ADSCOUT_STORE_DIR', path.join(process.cwd(), 'unsafe-shared-override'));
  expect(storeDir(A)).toBe(path.join(process.cwd(), 'test-volume', 'workspaces', A, 'ad-intel'));
  expect(storeDir(B)).not.toBe(storeDir(A));
  expect(() => storeDir('../')).toThrow();
});
test('watchlists, saved ads, usage and sync metadata never cross workspace boundaries', () => {
  root = mkdtempSync(path.join(tmpdir(), 'ad-isolation-')); vi.stubEnv('DATA_DIR', root);
  addWatchEntry(A, { id: 'private-brand', name: 'Private A' });
  expect(readWatchEntries(A)).toHaveLength(1);
  expect(readWatchEntries(B)).toEqual([]);
  saveAd(A, toWallAd({ id: 'private-ad' }));
  expect(readSavedAds(A)).toHaveLength(1);
  expect(readSavedAds(B)).toEqual([]);
  adStore(A).writeMeta({ lastSyncAt: '2026-10-03', lastSyncCalls: 3 });
  expect(adStore(B).readMeta()).toEqual({ lastSyncAt: null, lastSyncCalls: 0 });
  expect(adStore(B).readUsage()).toBeNull();
  expect(() => readSavedAds('../')).toThrow();
});
