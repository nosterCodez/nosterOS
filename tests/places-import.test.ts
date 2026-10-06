import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { importPlaces, MAX_PLACES_BYTES } from '@/lib/leads/places-import';
import { foursquareSource } from '@/lib/leads/sources/foursquare';
const roots: string[] = [];
const options = () => ({ file: path.resolve('tests/fixtures/places/places.parquet'), bbox: [-98.6, 25.84, -97.1, 26.65], releaseDate: '2026-09-15', dataRoot: roots[roots.push(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-places-'))) - 1] });
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
test('local Parquet import selects bounding box, stores date, and exposes only public source fields', async () => {
  const result = await importPlaces(options());
  expect(result.count).toBe(1); expect(result.bytes).toBeLessThan(MAX_PLACES_BYTES);
  const source = foursquareSource(result.output);
  const rows = await source.find({ city: 'Mission, TX', queries: [], limit: 5, signal: new AbortController().signal });
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id: 'fixture-inside', source: 'foursquare', refreshedAt: '2026-09-15T00:00:00.000Z' });
  const db = new Database(result.output, { readonly: true });
  try { expect(db.prepare('PRAGMA table_info(places)').all().map((r: any) => r.name)).not.toContain('workspace_id'); }
  finally { db.close(); }
  expect(source.costPerCallUsd).toBe(0); expect(source.attribution).toContain('Apache-2.0');
});
test('storage caps fail without publishing; existing imports are not replaced', async () => {
  const input = options(); await expect(importPlaces({ ...input, maxBytes: 100 })).rejects.toThrow('cap');
  expect(fs.readdirSync(path.join(input.dataRoot, 'shared'))).toEqual([]);
  const result = await importPlaces(input), before = fs.readFileSync(result.output);
  await expect(importPlaces(input)).rejects.toThrow('Existing import preserved');
  expect(fs.readFileSync(result.output)).toEqual(before);
});
test('remote URLs, invalid bounds and missing local sources do not fetch', async () => {
  await expect(importPlaces({ ...options(), file: 'https://example.test/places.parquet' })).rejects.toThrow('Local authorized');
  await expect(importPlaces({ ...options(), bbox: [10, 10, 0, 0] })).rejects.toThrow('Invalid bounding');
  await expect(foursquareSource(path.join(options().dataRoot, 'missing.db')).find({ city: 'Mission', queries: [], limit: 5, signal: new AbortController().signal })).rejects.toThrow('source_not_imported');
});
