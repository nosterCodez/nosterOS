import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { snapshotDatabases } from '@/lib/backup/snapshot';
import { packArchive, unpackArchive } from '@/lib/backup/package';
import { spendDbPath } from '@/lib/paths';
test('platform spending DB is included in validated backup snapshots and archive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-spend-backup-'));
  try {
    const filename = spendDbPath({ DATA_DIR: root });
    expect(filename).toBe(path.join(root, 'platform', 'spend.db'));
    await fs.mkdir(path.dirname(filename), { recursive: true });
    for (const name of [path.join(root, 'control.db'), filename]) { const db = new Database(name); db.exec('CREATE TABLE fixture (id INTEGER)'); db.close(); }
    const snapshots = await snapshotDatabases(root);
    expect(snapshots.map(s => s.name)).toEqual(['control.db', 'platform/spend.db']);
    await expect(unpackArchive(await packArchive(snapshots, 'abcdef12'))).resolves.toBeDefined();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
