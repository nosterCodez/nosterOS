import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { VERIFICATION_RESULTS, VERIFICATION_NOTES, type VerificationResult } from '@/lib/verification-types';

const VerificationResultSchema = z.object({ status: z.enum(VERIFICATION_RESULTS), note: z.enum(VERIFICATION_NOTES).optional() }).strict();
const RecordSchema = z.object({
  name: z.string(), generation: z.string(), result: VerificationResultSchema.nullable(),
  checkedAt: z.string().datetime().nullable(), verifiedAt: z.string().datetime().nullable(),
  attemptedAt: z.number(), claim: z.string().nullable(), claimUntil: z.number(),
}).strict();
type Record = z.infer<typeof RecordSchema>;
export function createVerificationRecords(db: Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS connection_verifications(name TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connection_check_limits(id INTEGER PRIMARY KEY,at INTEGER NOT NULL)');
  const get = (name: string): Record | undefined => {
    const row = db.prepare('SELECT payload FROM connection_verifications WHERE name=?').get(name) as { payload: string } | undefined;
    return row ? RecordSchema.parse(JSON.parse(row.payload)) : undefined;
  };
  const put = (row: Record) => db.prepare('INSERT INTO connection_verifications(name,payload) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET payload=excluded.payload').run(row.name, JSON.stringify(RecordSchema.parse(row)));
  return {
    get,
    takeManual(now = Date.now()) {
      return db.transaction(() => {
        db.prepare('DELETE FROM connection_check_limits WHERE at<=?').run(now - 60000);
        if ((db.prepare('SELECT COUNT(*) AS count FROM connection_check_limits').get() as { count: number }).count >= 5) return false;
        db.prepare('INSERT INTO connection_check_limits(at) VALUES (?)').run(now); return true;
      }).immediate();
    },
    claim(name: string, generation: string, now: number, daily = false) {
      return db.transaction(() => {
        const old = get(name);
        if (old && old.generation === generation && (old.claimUntil > now || (daily && now - old.attemptedAt < 86400000))) return null;
        const claim = randomUUID(), same = old?.generation === generation;
        put({ name, generation, result: same ? old.result : null, checkedAt: same ? old.checkedAt : null, verifiedAt: same ? old.verifiedAt : null, attemptedAt: now, claim, claimUntil: now + 30000 });
        return claim;
      }).immediate();
    },
    owns(name: string, claim: string) { return get(name)?.claim === claim; },
    finish(name: string, claim: string, generation: string, result: VerificationResult, now = Date.now()) {
      const row = get(name); if (!row || row.claim !== claim) return false;
      const at = new Date(now).toISOString();
      put({ ...row, generation, result, checkedAt: at, verifiedAt: result.status === 'verified' ? at : row.generation === generation ? row.verifiedAt : null, claim: null, claimUntil: 0 }); return true;
    },
    release(name: string, claim: string) { const row = get(name); if (row?.claim === claim) put({ ...row, claim: null, claimUntil: 0 }); },
    invalidate(name: string) { const row = get(name); if (row) put({ ...row, claim: null, claimUntil: 0, generation: '', result: null, checkedAt: null, verifiedAt: null }); },
  };
}
