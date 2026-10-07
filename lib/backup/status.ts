import { requireWorkspace } from '@/lib/session';
import { isPlatformOwner } from '@/lib/platform-owner';
import { controlDbPath } from '@/lib/paths';
import { readBackupSummary } from '@/lib/backup/repository';

export async function platformBackupStatus() {
  const context = await requireWorkspace();
  if (!isPlatformOwner(context)) return null;
  const empty = { latest: null, lastSuccess: null, running: null, lastError: null, archiveCount: null, stale: true };
  try { return readBackupSummary(controlDbPath()) ?? empty; }
  catch { return { ...empty, lastError: 'Backup status unavailable.' }; }
}
export type PlatformBackupStatus = NonNullable<Awaited<ReturnType<typeof platformBackupStatus>>>;
