import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DatabaseName, MAX_ARCHIVE_BYTES, type Snapshot } from '@/lib/backup/package';

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function inventory(root: string) {
  const names: string[] = []; let total = 0; let entries = 0;
  async function walk(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (++entries > 50_000) throw new Error('Data inventory exceeds limit');
      if (entry.isSymbolicLink()) throw new Error('Data inventory contains a link');
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(filename); continue; }
      if (!entry.isFile()) throw new Error('Unsupported data entry');
      total += (await fs.stat(filename)).size;
      if (total > 400_000_000) throw new Error('Data exceeds 80 percent of the 500 MB volume');
      if (entry.name.endsWith('.db')) {
        const name = path.relative(root, filename).split(path.sep).join('/');
        DatabaseName.parse(name); names.push(name);
      }
    }
  }
  await walk(root);
  if (!names.includes('control.db') || names.length > 4096) throw new Error('Invalid database inventory');
  return names.sort();
}
/** Approved temporary snapshots only: private scratch directory, cleaned even on failure. */
export async function snapshotDatabases(dataRoot: string, tempParent = os.tmpdir()): Promise<Snapshot[]> {
  const root = await fs.realpath(dataRoot), parent = await fs.realpath(tempParent);
  if (inside(root, parent)) throw new Error('Snapshot scratch must be outside live data');
  const names = await inventory(root);
  const scratch = await fs.mkdtemp(path.join(parent, 'omega-snapshot-'));
  const files: Snapshot[] = []; let total = 0;
  try {
    await fs.chmod(scratch, 0o700);
    for (const [index, name] of names.entries()) {
      const source = path.join(root, ...name.split('/'));
      if ((await fs.lstat(source)).isSymbolicLink() || await fs.realpath(source) !== source) throw new Error('Database path changed');
      const destination = path.join(scratch, `${index}.db`);
      const handle = await fs.open(destination, 'wx', 0o600); await handle.close();
      const db = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 });
      try {
        const started = Date.now();
        await db.backup(destination, { progress: () => {
          if (Date.now() - started > 60_000) throw new Error('Snapshot timed out');
          return 256;
        } });
      } finally { db.close(); }
      const snapshot = new Database(destination, { fileMustExist: true });
      let schemaVersion: number;
      try {
        // The online source stays WAL. Only this isolated copy becomes self-contained.
        snapshot.pragma('journal_mode = DELETE');
        if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Snapshot integrity failed');
        schemaVersion = snapshot.pragma('user_version', { simple: true }) as number;
      } finally { snapshot.close(); }
      const size = (await fs.stat(destination)).size; total += size;
      if (total > MAX_ARCHIVE_BYTES) throw new Error('Snapshots exceed size limit');
      files.push({ name, bytes: await fs.readFile(destination), schemaVersion });
      await fs.unlink(destination);
    }
    if (JSON.stringify(await inventory(root)) !== JSON.stringify(names)) throw new Error('Database inventory changed during backup');
    return files;
  } finally {
    // Only our generated direct child may be removed; never a caller-provided path.
    if (path.dirname(scratch) !== parent || !path.basename(scratch).startsWith('omega-snapshot-')
      || (await fs.lstat(scratch)).isSymbolicLink()) throw new Error('Invalid snapshot cleanup path');
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
