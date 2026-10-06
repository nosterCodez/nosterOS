import { PageHeader } from '@/components/PageHeader';
import { BackupStatus } from '@/components/BackupStatus';
import { platformBackupStatus } from '@/lib/backup/status';
import { operatorWorkspaceForPage } from '@/lib/session';
import { OperatorUnavailable } from '@/components/OperatorUnavailable';
export const dynamic = 'force-dynamic';
export default async function PlatformPage() {
  const workspace = await operatorWorkspaceForPage();
  if (!workspace) return <OperatorUnavailable />;
  const status = await platformBackupStatus();
  if (!status) return <><PageHeader title="Platform" /><p>Only the platform owner can view these settings.</p></>;
  return <><PageHeader eyebrow="Platform settings" title="Backup status" /><BackupStatus status={status} /></>;
}
