import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { decryptArchive } from '@/lib/backup/archive';
import { unpackArchive } from '@/lib/backup/package';

function within(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
/** The caller must choose a new scratch directory outside the live data tree. */
export async function restoreArchive(archive: Buffer, key: Buffer, to: string, liveDataDir: string) {
  const requested = path.resolve(to);
  const parent = await fs.realpath(path.dirname(requested));
  const target = path.join(parent, path.basename(requested));
  const live = await fs.realpath(liveDataDir);
  if (within(live, target) || within(target, live)) throw new Error('Restore must be outside live data');
  const { manifest, files } = await unpackArchive(decryptArchive(archive, key));
  // Validate all databases before writing any file, including SQLite's internal consistency.
  for (const file of files) {
    const db = new Database(file.bytes);
    try {
      if (db.pragma('integrity_check', { simple: true }) !== 'ok'
        || db.pragma('user_version', { simple: true }) !== file.schemaVersion) throw new Error('Backup database verification failed');
    } finally { db.close(); }
  }
  await fs.mkdir(target, { mode: 0o700 }); // EEXIST is intentional; never restore over anything.
  for (const file of files) {
    const filename = path.join(target, ...file.name.split('/'));
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await fs.writeFile(filename, file.bytes, { flag: 'wx', mode: 0o600 });
  }
  return { files: files.length, appCommit: manifest.appCommit };
}
