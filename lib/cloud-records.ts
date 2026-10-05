import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export const CloudSnapshotSchema = z.object({ at: z.string().datetime(), period: z.string().max(200), values: z.record(z.string(), z.number().finite().nullable()), mode: z.enum(['test', 'live']).optional() }).strict();
export type CloudSnapshot = z.infer<typeof CloudSnapshotSchema>;
const SourceSchema = z.object({ id: z.string(), resource: z.string(), enabled: z.boolean(), revision: z.string(), credentialVersion: z.string(), lastAttempt: z.number().nullable(), snapshot: CloudSnapshotSchema.nullable(), error: z.string().nullable(), claim: z.string().nullable(), claimUntil: z.number() });
export type SourceRecord = z.infer<typeof SourceSchema>;
export function createCloudSources(db: Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS cloud_sources(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS cloud_source_history(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,revision TEXT NOT NULL,resource TEXT NOT NULL,credential_version TEXT NOT NULL,payload TEXT NOT NULL)');
  const get = (id: string): SourceRecord | undefined => { const r = db.prepare('SELECT payload FROM cloud_sources WHERE id=?').get(id) as { payload: string } | undefined; return r ? SourceSchema.parse(JSON.parse(r.payload)) : undefined; };
  const put = (row: SourceRecord) => db.prepare('INSERT INTO cloud_sources(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(row.id, JSON.stringify(SourceSchema.parse(row)));
  return {
    get,
    configure(id: string, resource: string, enabled: boolean, credentialVersion: string) {
      const old = get(id), sameSource = old?.resource === resource && old?.credentialVersion === credentialVersion;
      put({ id, resource, enabled, credentialVersion, revision: randomUUID(), lastAttempt: old?.lastAttempt ?? null, snapshot: sameSource ? old?.snapshot ?? null : null, error: null, claim: null, claimUntil: 0 });
    },
    claim(id: string, revision: string, claim: string, now: number) {
      return db.transaction(() => { const r = get(id); if (!r || !r.enabled || r.revision !== revision || r.claimUntil > now || (r.lastAttempt !== null && now - r.lastAttempt < 15 * 60_000)) return false;
        put({ ...r, claim, claimUntil: now + 120_000, lastAttempt: now }); return true;
      }).immediate();
    },
    finish(id: string, revision: string, claim: string, snapshot: CloudSnapshot | null, error: string | null, writePoints: () => void = () => {}) {
      return db.transaction(() => { const r = get(id); if (!r || !r.enabled || r.revision !== revision || r.claim !== claim) return false;
        if (snapshot) {
          writePoints();
          db.prepare('INSERT INTO cloud_source_history(source_id,revision,resource,credential_version,payload) VALUES (?,?,?,?,?)').run(id, revision, r.resource, r.credentialVersion, JSON.stringify(CloudSnapshotSchema.parse(snapshot)));
        }
        put({ ...r, snapshot: snapshot ?? r.snapshot, error, claim: null, claimUntil: 0 }); return true;
      }).immediate();
    },
    invalidate(id: string) { const r = get(id); if (r) put({ ...r, enabled: false, revision: randomUUID(), claim: null, claimUntil: 0 }); },
  };
}
