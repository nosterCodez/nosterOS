import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { dataDir } from '@/lib/paths';
import { envMode } from '@/lib/env-mode';
import { backupKey } from '@/lib/backup/archive';
import { LocalDirBackupStore, configuredStore } from '@/lib/backup/store';
import { runBackup } from '@/lib/backup/run';
import { restoreArchive } from '@/lib/backup/restore';

export async function backupCLI(mode: 'now' | 'restore') {
  try {
    if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
    const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false,
      options: { 'local-dir': { type: 'string' }, ...(mode === 'restore' ? { archive: { type: 'string' as const }, to: { type: 'string' as const } } : {}) } });
    const environment = envMode();
    const root = dataDir();
    const local = values['local-dir'];
    if (local) {
      const source = fs.realpathSync(root), destination = fs.realpathSync(local);
      const relative = path.relative(source, destination);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Invalid local destination');
    }
    const store = local ? new LocalDirBackupStore(local, environment) : configuredStore(process.env, environment);
    if (mode === 'now') {
      let appCommit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.OMEGA_BACKUP_APP_COMMIT;
      if (!appCommit && environment === 'development') appCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim();
      const result = await runBackup({ root, store, appCommit: appCommit ?? '' });
      console.log(JSON.stringify(result));
      if (result.status === 'failed') process.exitCode = 1;
    } else {
      if (typeof values.archive !== 'string' || typeof values.to !== 'string' || !values.archive || !values.to) throw new Error('Missing restore arguments');
      const key = backupKey();
      try { console.log(JSON.stringify(await restoreArchive(await store.get(values.archive), key, values.to, root))); }
      finally { key.fill(0); }
    }
  } catch {
    console.error('Backup command refused or failed. Check configuration, archive, and scratch paths; existing data was not overwritten.');
    process.exitCode = 1;
  }
}
