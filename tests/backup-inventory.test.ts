import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';
import { snapshotDatabases } from '@/lib/backup/snapshot';
import { DatabaseName, packArchive, unpackArchive } from '@/lib/backup/package';
import { restoreArchive } from '@/lib/backup/restore';
import { encryptArchive } from '@/lib/backup/archive';
import { randomBytes } from 'node:crypto';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(names: string[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-inventory-')); roots.push(root);
  const data = path.join(root, 'data'); await fs.mkdir(data);
  for (const name of ['control.db', ...names]) {
    const filename = path.join(data, ...name.split('/'));
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const db = new Database(filename);
    try { db.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('safe snapshot')"); } finally { db.close(); }
  }
  return { root, data };
}

test('F1 snapshots and restores unfamiliar root and nested platform databases', async () => {
  const names = ['gbrain.db', 'novel-name.v2.db', 'platform/metrics.db', 'platform/new feature/report.v2.db',
    `workspaces/${'a'.repeat(32)}/nosteros.db`];
  const f = await fixture(names);
  const snapshots = await snapshotDatabases(f.data, f.root);
  expect(snapshots.map(s => s.name)).toEqual(['control.db', ...names].sort());
  const packed = await packArchive(snapshots, 'abcdef12');
  expect((await unpackArchive(packed)).files).toEqual(snapshots);
  const key = randomBytes(32), restored = path.join(f.root, 'restored');
  expect(await restoreArchive(encryptArchive(packed, key), key, restored, f.data)).toMatchObject({ files: 6 });
  for (const name of names) {
    const db = new Database(path.join(restored, ...name.split('/')), { readonly: true });
    try { expect(db.prepare('SELECT value FROM fixture').pluck().get()).toBe('safe snapshot'); } finally { db.close(); }
  }
});

test('F1 ignores all of shared including invalid databases and nested data', async () => {
  const f = await fixture(['shared/places.db']);
  await fs.mkdir(path.join(f.data, 'shared', 'nested'));
  await fs.writeFile(path.join(f.data, 'shared', 'nested', 'invalid.db'), 'not SQLite');
  await fs.writeFile(path.join(f.data, 'shared', '.env'), 'excluded fixture content');
  expect((await snapshotDatabases(f.data, f.root)).map(s => s.name)).toEqual(['control.db']);
});

test.each(['other/unknown.db', 'workspaces/not-an-id/new.db', `workspaces/${'a'.repeat(32)}/nested/new.db`])(
  'F1 still refuses unexpected database location %s', async name => {
    const f = await fixture([name]);
    await expect(snapshotDatabases(f.data, f.root)).rejects.toThrow();
  });

test.each(['../outside.db', '/outside.db', 'platform/../outside.db', 'platform//x.db',
  'platform/./x.db', 'platform/C:/x.db', 'platform\\x.db', 'platform/x.db:stream',
  'platform/trailing. /x.db', 'shared/places.db', '.env.local'])('F1 archive refuses unsafe/excluded path %s', name => {
  expect(DatabaseName.safeParse(name).success).toBe(false);
});
