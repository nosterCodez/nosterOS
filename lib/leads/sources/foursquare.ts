import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { dataDir } from '@/lib/paths';
import { Place, type LeadSource } from './types';
export function foursquareSource(filename = path.join(dataDir(), 'shared', 'places.db')): LeadSource {
  return { id: 'foursquare', costPerCallUsd: 0, attribution: 'Foursquare OS Places (Apache-2.0)', attributionUrl: 'https://opensource.foursquare.com/os-places/',
    async find(input) {
      input.signal.throwIfAborted();
      if (!fs.existsSync(filename)) throw new Error('source_not_imported');
      const db = new Database(filename, { readonly: true, fileMustExist: true });
      try {
        const rows = db.prepare("SELECT 'foursquare' AS source,id,name,category,address,city,latitude,longitude,website,phone,release_date AS releaseDate FROM places WHERE city=? COLLATE NOCASE ORDER BY id LIMIT ?")
          .all(input.city.split(',')[0].trim(), Math.min(500, Math.max(0, input.limit))) as Record<string, unknown>[];
        return rows.map(({ releaseDate, ...row }) => Place.parse({ ...row, refreshedAt: new Date(String(releaseDate)).toISOString() }));
      } finally { db.close(); }
    } };
}
