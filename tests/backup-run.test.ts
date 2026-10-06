import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { snapshotDatabases } from '@/lib/backup/snapshot';
import { runBackup } from '@/lib/backup/run';
import { backupRepository } from '@/lib/backup/repository';
import { LocalDirBackupStore } from '@/lib/backup/store';
import { restoreArchive } from '@/lib/backup/restore';
import { encryptArchive } from '@/lib/backup/archive';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-backup-run-')); roots.push(root);
  const data = path.join(root, 'data'), temp = path.join(root, 'temp'), bucket = path.join(root, 'bucket');
  for (const dir of [data, temp, bucket]) await fs.mkdir(dir);
  const workspace = path.join(data, 'workspaces', 'a'.repeat(32)); await fs.mkdir(workspace, { recursive: true });
  for (const filename of [path.join(data, 'control.db'), path.join(workspace, 'nosteros.db')]) {
    const db = new Database(filename); db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('backed up'); PRAGMA user_version=7"); db.close();
  }
  return { root, data, temp, bucket, env: { OMEGA_BACKUP_KEY: randomBytes(32).toString('base64') }, store: new LocalDirBackupStore(bucket, 'development') };
}
test('online snapshot includes WAL commits, only databases, and cleans temporary files on success/failure', async () => {
  const f = await fixture(), db = new Database(path.join(f.data, 'control.db'));
  db.exec("INSERT INTO fixture VALUES ('in WAL')");
  await fs.writeFile(path.join(f.data, '.env.local'), 'fixture-env-secret');
  try {
    const snapshots = await snapshotDatabases(f.data, f.temp);
    expect(snapshots).toHaveLength(2);
    const restored = new Database(snapshots.find(s => s.name === 'control.db')!.bytes);
    try { expect(restored.prepare('SELECT COUNT(*) FROM fixture').pluck().get()).toBe(2); } finally { restored.close(); }
    expect(await fs.readdir(f.temp)).toEqual([]);
    expect(snapshots.some(s => s.bytes.includes(Buffer.from('fixture-env-secret')))).toBe(false);
  } finally { db.close(); }
  await fs.writeFile(path.join(f.data, 'workspaces', 'a'.repeat(32), 'invalid.db'), 'not sqlite');
  await expect(snapshotDatabases(f.data, f.temp)).rejects.toThrow();
  expect(await fs.readdir(f.temp)).toEqual([]);
  await expect(snapshotDatabases(f.data, f.data)).rejects.toThrow();
});
test('backup -> encrypted local store -> restore recovers every DB and records status; runs at most daily', async () => {
  const f = await fixture(), now = new Date('2026-10-05T08:00:00Z');
  const result = await runBackup({ root: f.data, temp: f.temp, store: f.store, env: f.env, appCommit: 'abcdef12', now });
  expect(result.status).toBe('success');
  const objects = await f.store.list(); expect(objects).toHaveLength(1);
  const restored = path.join(f.root, 'restore');
  expect(await restoreArchive(await f.store.get(objects[0].name), Buffer.from(f.env.OMEGA_BACKUP_KEY, 'base64'), restored, f.data)).toMatchObject({ files: 2 });
  const db = new Database(path.join(restored, 'workspaces', 'a'.repeat(32), 'nosteros.db'));
  try { expect(db.prepare('SELECT value FROM fixture').pluck().get()).toBe('backed up'); } finally { db.close(); }
  const repo = backupRepository(path.join(f.data, 'control.db'));
  try { expect(repo.summary(now).lastSuccess?.status).toBe('success'); expect(repo.summary(now).archiveCount).toBe(1); } finally { repo.close(); }
  expect((await runBackup({ root: f.data, temp: f.temp, store: f.store, env: f.env, appCommit: 'abcdef12', now })).status).toBe('skipped');
});
test('corrupt uploaded copy prevents all pruning, masks error and releases lock', async () => {
  const f = await fixture(), remove = vi.fn();
  const store = { put: vi.fn(), get: vi.fn().mockResolvedValue(Buffer.from('corrupt provider token fixture-secret')), list: vi.fn(), delete: remove };
  const result = await runBackup({ root: f.data, temp: f.temp, store, env: f.env, appCommit: 'abcdef12', now: new Date('2026-10-05T08:00:00Z') });
  expect(result.status).toBe('failed'); expect(remove).not.toHaveBeenCalled(); expect(store.list).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('fixture-secret'); expect(await fs.readdir(f.temp)).toEqual([]);
  const repo = backupRepository(path.join(f.data, 'control.db'));
  try { expect(repo.summary().running).toBeNull(); expect(repo.summary().lastError).toBe('Backup verification failed.'); } finally { repo.close(); }
});
test('SQLite fresh running lock prevents overlap across repository handles, including across midnight', async () => {
  const f = await fixture(), filename = path.join(f.data, 'control.db'), a = backupRepository(filename), b = backupRepository(filename);
  try {
    const id = a.claim(new Date('2026-10-05T23:30:00Z'), 'omegaos-2026-10-05-abcdef12.tar.gz');
    expect(id).not.toBeNull();
    expect(b.claim(new Date('2026-10-06T00:30:00Z'), 'omegaos-2026-10-06-abcdef12.tar.gz')).toBeNull();
    expect(b.summary().running?.id).toBe(id);
    expect(b.summary(new Date('2026-10-07T08:00:00Z')).stale).toBe(true);
  } finally { a.close(); b.close(); }
});
test('missing encryption key refuses before any store call or snapshot', async () => {
  const f = await fixture(), put = vi.spyOn(f.store, 'put');
  await expect(runBackup({ root: f.data, temp: f.temp, store: f.store, env: {}, appCommit: 'abcdef12' })).rejects.toThrow('OMEGA_BACKUP_KEY');
  expect(put).not.toHaveBeenCalled(); expect(await fs.readdir(f.temp)).toEqual([]);
});
test('verified backup prunes to seven daily plus four older Sundays and exposes 36-hour freshness', async () => {
  const f = await fixture(), key = Buffer.from(f.env.OMEGA_BACKUP_KEY, 'base64');
  for (let i = 1; i <= 50; i++) {
    const date = new Date(Date.UTC(2026, 9, 5 - i)).toISOString().slice(0, 10);
    await f.store.put(`omegaos-${date}-abcdef12.tar.gz`, encryptArchive(Buffer.from('old fixture archive'), key));
  }
  expect(await runBackup({ root: f.data, temp: f.temp, store: f.store, env: f.env, appCommit: 'abcdef12', now: new Date('2026-10-05T08:00:00Z') })).toMatchObject({ status: 'success', count: 11 });
  expect(await f.store.list()).toHaveLength(11);
  const repo = backupRepository(path.join(f.data, 'control.db'));
  try {
    expect(repo.summary(new Date('2026-10-06T19:00:00Z')).stale).toBe(false);
    expect(repo.summary(new Date('2026-10-06T21:00:00Z')).stale).toBe(true);
  } finally { repo.close(); }
});
test('upload failure never reads or prunes remote archives and reports a constant message', async () => {
  const f = await fixture();
  const store = { put: vi.fn().mockRejectedValue(new Error('fixture-provider-secret')), get: vi.fn(), list: vi.fn(), delete: vi.fn() };
  expect(await runBackup({ root: f.data, temp: f.temp, store, env: f.env, appCommit: 'abcdef12' })).toEqual({ status: 'failed', error: 'Backup upload failed.' });
  expect(store.get).not.toHaveBeenCalled(); expect(store.list).not.toHaveBeenCalled(); expect(store.delete).not.toHaveBeenCalled();
});
