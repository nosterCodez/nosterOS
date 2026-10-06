import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { z } from 'zod';
import { Place, publicWebsite } from './sources/types';
export const MAX_PLACES_BYTES = 60 * 1024 * 1024;
export const BoundingBox = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .refine(([west, south, east, north]) => west < east && south < north, 'Invalid bounding box');
function directoryBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((size, entry) => {
    if (entry.isSymbolicLink()) throw new Error('Data symlinks are not supported');
    const name = path.join(dir, entry.name);
    return size + (entry.isDirectory() ? directoryBytes(name) : fs.statSync(name).size);
  }, 0);
}
/** Only an explicitly supplied local, authorized Parquet file. Never downloads data or accepts access terms. */
export async function importPlaces(options: { file: string; bbox: number[]; releaseDate: string; dataRoot: string; maxBytes?: number }) {
  const bbox = BoundingBox.parse(options.bbox);
  const release = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s).parse(options.releaseDate);
  if (/^https?:/i.test(options.file)) throw new Error('Local authorized file required');
  const root = path.resolve(options.dataRoot), shared = path.join(root, 'shared'), output = path.join(shared, 'places.db');
  if (fs.existsSync(output)) throw new Error('Existing import preserved; replacement requires a separately reviewed refresh');
  const before = directoryBytes(root), max = Math.min(MAX_PLACES_BYTES, options.maxBytes ?? MAX_PLACES_BYTES);
  if (before >= 400 * 1024 * 1024) throw new Error('Data volume would exceed 80 percent of 500 MB');
  const input = await asyncBufferFromFile(options.file), metadata = await parquetMetadataAsync(input);
  const required = ['fsq_place_id', 'name', 'latitude', 'longitude', 'locality'];
  const available = new Set(metadata.schema.map(s => s.name));
  if (required.some(s => !available.has(s))) throw new Error('Unsupported places schema');
  const columns = [...required, 'fsq_category_labels', 'address', 'website', 'tel'].filter(c => available.has(c));
  const total = Number(metadata.num_rows);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid row count');
  fs.mkdirSync(shared, { recursive: true });
  const temporary = path.join(shared, `places-${randomUUID()}.tmp`);
  const db = new Database(temporary); let open = true, count = 0;
  try {
    db.pragma('journal_mode = MEMORY');
    db.exec('CREATE TABLE places(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,address TEXT NOT NULL,city TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,website TEXT NOT NULL,phone TEXT NOT NULL,release_date TEXT NOT NULL); CREATE INDEX places_city ON places(city COLLATE NOCASE); CREATE TABLE metadata(release_date TEXT NOT NULL,bbox TEXT NOT NULL,attribution TEXT NOT NULL);');
    db.prepare('INSERT INTO metadata VALUES (?,?,?)').run(release, JSON.stringify(bbox), 'Foursquare OS Places, Apache-2.0');
    const insert = db.prepare('INSERT OR IGNORE INTO places VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (let offset = 0; offset < total; offset += 1000) {
      const rows = await parquetReadObjects({ file: input, metadata, columns, rowStart: offset, rowEnd: Math.min(total, offset + 1000),
        filter: { $and: [{ latitude: { $gte: bbox[1], $lte: bbox[3] } }, { longitude: { $gte: bbox[0], $lte: bbox[2] } }] } });
      db.transaction(() => {
        for (const r of rows) {
          const categories = Array.isArray(r.fsq_category_labels) ? r.fsq_category_labels.filter((v: unknown) => typeof v === 'string').join(', ') : String(r.fsq_category_labels ?? '');
          const place = Place.safeParse({ source: 'foursquare', id: r.fsq_place_id, name: r.name, category: categories.slice(0, 500),
            city: r.locality, address: String(r.address ?? '').slice(0, 600), latitude: r.latitude, longitude: r.longitude,
            website: publicWebsite(r.website), phone: String(r.tel ?? '').slice(0, 100), refreshedAt: new Date(release).toISOString() });
          if (!place.success) continue;
          const p = place.data;
          if (p.longitude < bbox[0] || p.longitude > bbox[2] || p.latitude < bbox[1] || p.latitude > bbox[3]) continue;
          count += insert.run(p.id, p.name, p.category, p.address, p.city, p.latitude, p.longitude, p.website, p.phone, release).changes;
        }
      }).immediate();
      const bytes = fs.statSync(temporary).size;
      if (bytes > max) throw new Error('Places import exceeds 60 MB cap');
      if (before + bytes > 400 * 1024 * 1024) throw new Error('Data volume would exceed 80 percent of 500 MB');
    }
    db.close(); open = false;
    const bytes = fs.statSync(temporary).size;
    if (bytes > max || before + bytes > 400 * 1024 * 1024) throw new Error('Import exceeds storage cap');
    // Hard-link publication fails if another importer already published; no existing data is replaced.
    fs.linkSync(temporary, output);
    return { count, bytes, releaseDate: release, bbox, output };
  } finally { if (open) db.close(); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
