import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';
import { backupRepository } from '@/lib/backup/repository';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-backup-recovery-')); roots.push(root);
  const filename = path.join(root, 'control.db'); new Database(filename).close();
  return { a: backupRepository(filename), b: backupRepository(filename), filename };
}
const name = (day: string) => `omegaos-${day}-abcdef12.tar.gz`;

test('F2 preserves a live lock at exactly two hours, then marks it interrupted before checking the daily limit', async () => {
  const f = await fixture();
  try {
    const id = f.a.claim(new Date('2026-10-06T08:00:00Z'), name('2026-10-06'));
    expect(id).not.toBeNull();
    expect(f.b.claim(new Date('2026-10-06T10:00:00Z'), name('2026-10-06'))).toBeNull();
    expect(f.b.summary().running?.id).toBe(id);
    expect(f.b.claim(new Date('2026-10-06T10:00:00.001Z'), name('2026-10-06'))).toBeNull();
    expect(f.b.summary().latest).toMatchObject({ id, status: 'failed', error_code: 'interrupted',
      finished_at: '2026-10-06T10:00:00.001Z' });
    expect(f.b.summary().running).toBeNull();
  } finally { f.a.close(); f.b.close(); }
});

test('F2 reclaims a prior-day interrupted run atomically across handles; late finish cannot overwrite recovery', async () => {
  const f = await fixture();
  try {
    const old = f.a.claim(new Date('2026-10-05T08:00:00Z'), name('2026-10-05'))!;
    const now = new Date('2026-10-06T08:00:00Z');
    const current = f.b.claim(now, name('2026-10-06'));
    expect(current).not.toBeNull(); expect(current).not.toBe(old);
    expect(f.a.claim(now, name('2026-10-06'))).toBeNull();
    f.a.finish(old, { bytes: 42, count: 1 }, now);
    const db = new Database(f.filename, { readonly: true });
    try { expect(db.prepare('SELECT status, error_code FROM backup_runs WHERE id=?').get(old))
      .toEqual({ status: 'failed', error_code: 'interrupted' }); } finally { db.close(); }
    expect(f.a.summary().running?.id).toBe(current);
  } finally { f.a.close(); f.b.close(); }
});

test('F2 leaves finished backups unchanged and preserves the once-per-day rule', async () => {
  const f = await fixture();
  try {
    const id = f.a.claim(new Date('2026-10-06T08:00:00Z'), name('2026-10-06'))!;
    f.a.finish(id, { bytes: 42, count: 1 }, new Date('2026-10-06T08:01:00Z'));
    expect(f.b.claim(new Date('2026-10-06T11:00:00Z'), name('2026-10-06'))).toBeNull();
    expect(f.b.summary().lastSuccess).toMatchObject({ id, status: 'success', error_code: null });
  } finally { f.a.close(); f.b.close(); }
});
