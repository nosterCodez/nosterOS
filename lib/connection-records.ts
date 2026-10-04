import type Database from 'better-sqlite3';
import { z } from 'zod';

export const EnvelopeSchema = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), ciphertext: z.string() }).strict();
export type Envelope = z.infer<typeof EnvelopeSchema>;
const KeySchema = z.object({ keyId: z.string(), envelope: EnvelopeSchema }).strict();
const RecordSchema = z.object({ name: z.string(), envelope: EnvelopeSchema, updatedAt: z.string(), revokedAt: z.string().nullable() }).strict();
export type ConnectionRecord = z.infer<typeof RecordSchema>;
export function createConnectionRecords(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS connection_key (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (name TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  return {
    atomic<T>(work: () => T): T { return db.transaction(work).immediate(); },
    key() { const row = db.prepare('SELECT payload FROM connection_key WHERE id=1').get() as { payload: string } | undefined; return row ? KeySchema.parse(JSON.parse(row.payload)) : undefined; },
    createKey(key: z.infer<typeof KeySchema>) { db.prepare('INSERT INTO connection_key(id,payload) VALUES (1,?)').run(JSON.stringify(KeySchema.parse(key))); },
    get(name: string) { const row = db.prepare('SELECT payload FROM connections WHERE name=?').get(name) as { payload: string } | undefined; return row ? RecordSchema.parse(JSON.parse(row.payload)) : undefined; },
    all() { return (db.prepare('SELECT payload FROM connections ORDER BY name').all() as { payload: string }[]).map(row => RecordSchema.parse(JSON.parse(row.payload))); },
    put(row: ConnectionRecord) { const record = RecordSchema.parse(row); db.prepare('INSERT INTO connections(name,payload) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET payload=excluded.payload').run(record.name, JSON.stringify(record)); },
  };
}
