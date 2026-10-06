import { dataDir } from '@/lib/paths';
import { envMode } from '@/lib/env-mode';
import { backupKey } from '@/lib/backup/archive';
import { configuredStore } from '@/lib/backup/store';
import { runBackup } from '@/lib/backup/run';

export function createBackupTick(warn: (message: string) => void = console.warn) {
  let warnedDay = '';
  return async (env: Record<string, string | undefined> = process.env, now = new Date()) => {
    if (now.getUTCHours() < 8) return { status: 'skipped' as const };
    const warning = () => {
      const day = now.toISOString().slice(0, 10);
      if (warnedDay !== day) { warnedDay = day; warn('[backup] Backup unavailable or failed; check owner status and server configuration.'); }
    };
    try {
      const key = backupKey(env); key.fill(0);
      const store = configuredStore(env, envMode(env));
      const appCommit = env.RAILWAY_GIT_COMMIT_SHA ?? env.OMEGA_BACKUP_APP_COMMIT ?? '';
      const result = await runBackup({ root: dataDir(env), store, env, appCommit, now });
      if (result.status === 'failed') warning();
      return result;
    } catch { warning(); return { status: 'failed' as const }; }
  };
}
export const runBackupTick = createBackupTick();
