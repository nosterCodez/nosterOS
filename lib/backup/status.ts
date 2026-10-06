import { requireWorkspace } from '@/lib/session';
import { operatorWorkspaceId } from '@/lib/operator-workspace';
import { controlDbPath } from '@/lib/paths';
import { readBackupSummary } from '@/lib/backup/repository';

export async function platformBackupStatus() {
  const context = await requireWorkspace();
  const owner = process.env.NOSTEROS_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || context.role !== 'owner' || context.user.email.trim().toLowerCase() !== owner
    || context.workspace.id !== operatorWorkspaceId()) return null;
  const empty = { latest: null, lastSuccess: null, running: null, lastError: null, archiveCount: null, stale: true };
  try { return readBackupSummary(controlDbPath()) ?? empty; }
  catch { return { ...empty, lastError: 'Backup status unavailable.' }; }
}
export type PlatformBackupStatus = NonNullable<Awaited<ReturnType<typeof platformBackupStatus>>>;
