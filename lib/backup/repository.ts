import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { archiveName } from '@/lib/backup/store';

export const BackupRun = z.object({
  id: z.string(), started_at: z.string().datetime(), finished_at: z.string().datetime().nullable(),
  status: z.enum(['running', 'success', 'failed']), archive_name: z.string(),
  bytes: z.number().int().nonnegative().nullable(), archive_count: z.number().int().nonnegative().nullable(),
  error_code: z.string().nullable(), error_message: z.string().max(200).nullable(),
});
export type BackupRun = z.infer<typeof BackupRun>;
export const BACKUP_ERRORS = {
  snapshot: 'Database snapshot failed.', package: 'Backup packaging failed.', upload: 'Backup upload failed.',
  verify: 'Backup verification failed.', prune: 'Backup retention failed.',
  interrupted: 'Backup interrupted after more than two hours.',
} as const;
export type BackupError = keyof typeof BACKUP_ERRORS;
function summary(db: Database.Database, now: Date) {
  const read = (where: string) => {
    const row = db.prepare(`SELECT * FROM backup_runs ${where} ORDER BY started_at DESC LIMIT 1`).get();
    return row ? BackupRun.parse(row) : null;
  };
  const latest = read(''), lastSuccess = read("WHERE status='success'"), running = read("WHERE status='running'");
  const failed = read("WHERE status='failed'");
  return { latest, lastSuccess, running, lastError: failed?.error_message ?? null,
    archiveCount: lastSuccess?.archive_count ?? null,
    stale: !lastSuccess?.finished_at || now.getTime() - Date.parse(lastSuccess.finished_at) > 36 * 60 * 60 * 1000 };
}
export function backupRepository(filename: string) {
  const db = new Database(filename, { fileMustExist: true, timeout: 5000 });
  db.exec(`CREATE TABLE IF NOT EXISTS backup_runs (
    id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL CHECK(status IN ('running','success','failed')),
    archive_name TEXT NOT NULL, bytes INTEGER, archive_count INTEGER, error_code TEXT, error_message TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS backup_single_running ON backup_runs(status) WHERE status='running';
    CREATE INDEX IF NOT EXISTS backup_runs_started ON backup_runs(started_at);`);
  return {
    claim(now: Date, name: string): string | null {
      archiveName(name); const started = now.toISOString();
      return db.transaction(() => {
        const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        db.prepare("UPDATE backup_runs SET status='failed',finished_at=?,error_code='interrupted',error_message=? WHERE status='running' AND started_at < ?")
          .run(started, BACKUP_ERRORS.interrupted, cutoff);
        if (db.prepare("SELECT id FROM backup_runs WHERE status='running' OR substr(started_at,1,10)=? LIMIT 1").get(started.slice(0, 10))) return null;
        const id = randomUUID();
        db.prepare("INSERT INTO backup_runs(id,started_at,status,archive_name) VALUES (?,?,'running',?)").run(id, started, name);
        return id;
      }).immediate();
    },
    finish(id: string, result: { bytes: number; count: number } | { error: BackupError }, now = new Date()) {
      if ('error' in result) db.prepare("UPDATE backup_runs SET status='failed', finished_at=?,error_code=?,error_message=? WHERE id=? AND status='running'")
        .run(now.toISOString(), result.error, BACKUP_ERRORS[result.error], id);
      else {
        z.object({ bytes: z.number().int().nonnegative(), count: z.number().int().nonnegative() }).parse(result);
        db.prepare("UPDATE backup_runs SET status='success',finished_at=?,bytes=?,archive_count=? WHERE id=? AND status='running'")
          .run(now.toISOString(), result.bytes, result.count, id);
      }
    },
    summary: (now = new Date()) => summary(db, now),
    close: () => db.close(),
  };
}
export function readBackupSummary(filename: string, now = new Date()) {
  let db: Database.Database | undefined;
  try {
    db = new Database(filename, { readonly: true, fileMustExist: true });
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_runs'").get()) return null;
    return summary(db, now);
  } finally { db?.close(); }
}
