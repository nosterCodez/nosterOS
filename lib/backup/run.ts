import path from 'node:path';
import { backupKey, encryptArchive, decryptArchive } from '@/lib/backup/archive';
import { packArchive, unpackArchive, buildManifest } from '@/lib/backup/package';
import { snapshotDatabases } from '@/lib/backup/snapshot';
import { backupRepository, BACKUP_ERRORS, type BackupError } from '@/lib/backup/repository';
import { retainedArchives } from '@/lib/backup/retention';
import type { BackupStore } from '@/lib/backup/store';

export async function runBackup(options: { root: string; temp?: string; store: BackupStore;
  env?: Record<string, string | undefined>; appCommit: string; now?: Date }) {
  const key = backupKey(options.env ?? process.env);
  if (!/^[a-f0-9]{7,40}$/.test(options.appCommit)) throw new Error('Configure a valid backup app commit');
  const now = options.now ?? new Date();
  const name = `omegaos-${now.toISOString().slice(0, 10)}-${options.appCommit.slice(0, 8)}.tar.gz`;
  const repo = backupRepository(path.join(options.root, 'control.db'));
  let stage: BackupError = 'snapshot';
  try {
    const id = repo.claim(now, name);
    if (!id) return { status: 'skipped' as const };
    try {
      const files = await snapshotDatabases(options.root, options.temp);
      stage = 'package';
      const expected = buildManifest(files, options.appCommit);
      const encrypted = encryptArchive(await packArchive(files, options.appCommit), key);
      stage = 'upload'; await options.store.put(name, encrypted);
      stage = 'verify';
      const verified = await unpackArchive(decryptArchive(await options.store.get(name), key));
      if (JSON.stringify(verified.manifest) !== JSON.stringify(expected)) throw new Error('Uploaded backup differs');
      stage = 'prune';
      const all = await options.store.list();
      if (!all.some(entry => entry.name === name)) throw new Error('Uploaded archive absent from listing');
      const keep = retainedArchives(all.map(entry => entry.name));
      // Always keep this verified upload even when the host clock is behind other archives.
      keep.add(name);
      for (const entry of all) if (!keep.has(entry.name)) await options.store.delete(entry.name);
      const count = (await options.store.list()).length;
      repo.finish(id, { bytes: encrypted.length, count }, options.now ?? new Date());
      return { status: 'success' as const, archive: name, bytes: encrypted.length, count };
    } catch {
      repo.finish(id, { error: stage }, options.now ?? new Date());
      return { status: 'failed' as const, error: BACKUP_ERRORS[stage] };
    }
  } finally { key.fill(0); repo.close(); }
}
