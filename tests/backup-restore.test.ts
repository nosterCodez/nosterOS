import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { encryptArchive } from '@/lib/backup/archive';
import { packArchive } from '@/lib/backup/package';
import { restoreArchive } from '@/lib/backup/restore';
import { retainedArchives } from '@/lib/backup/retention';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-restore-')); dirs.push(root);
  await fs.mkdir(path.join(root, 'live'));
  const db = new Database(':memory:');
  db.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('saved row'); PRAGMA user_version=2");
  const bytes = db.serialize(); db.close();
  const key = randomBytes(32), archive = encryptArchive(await packArchive([{ name: 'control.db', bytes, schemaVersion: 2 }], 'abcdef12'), key);
  return { root, key, archive };
}
test('restore verifies SQLite integrity and reproduces rows in a new directory only', async () => {
  const { root, key, archive } = await fixture(), target = path.join(root, 'restored');
  await restoreArchive(archive, key, target, path.join(root, 'live'));
  const db = new Database(path.join(target, 'control.db'), { readonly: true });
  try {
    expect(db.prepare('SELECT value FROM fixture').pluck().get()).toBe('saved row');
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { db.close(); }
  await expect(restoreArchive(archive, key, target, path.join(root, 'live'))).rejects.toThrow();
  await expect(restoreArchive(archive, key, path.join(root, 'live', 'restore'), path.join(root, 'live'))).rejects.toThrow();
});
test('wrong key and invalid SQLite fail before creating a target directory', async () => {
  const { root, key, archive } = await fixture(); const target = path.join(root, 'bad');
  await expect(restoreArchive(archive, randomBytes(32), target, path.join(root, 'live'))).rejects.toThrow();
  const invalid = encryptArchive(await packArchive([{ name: 'control.db', bytes: Buffer.from('invalid database'), schemaVersion: 0 }], 'abcdef12'), key);
  await expect(restoreArchive(invalid, key, target, path.join(root, 'live'))).rejects.toThrow();
  await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
});
test('retention preserves seven most recent daily archives plus four older Sundays', () => {
  const names = Array.from({ length: 60 }, (_, i) => `omegaos-${new Date(Date.UTC(2026, 9, 5 - i)).toISOString().slice(0, 10)}-abcdef12.tar.gz`);
  const keep = retainedArchives(names);
  expect(keep.size).toBe(11);
  for (const name of names.slice(0, 7)) expect(keep.has(name)).toBe(true);
  expect([...keep].filter(name => !names.slice(0, 7).includes(name))).toEqual([
    'omegaos-2026-09-27-abcdef12.tar.gz', 'omegaos-2026-09-20-abcdef12.tar.gz',
    'omegaos-2026-09-13-abcdef12.tar.gz', 'omegaos-2026-09-06-abcdef12.tar.gz',
  ]);
  expect(retainedArchives([]).size).toBe(0);
});
