import { PageHeader } from '@/components/PageHeader';
import { BackupStatus } from '@/components/BackupStatus';
import { platformBackupStatus } from '@/lib/backup/status';
export const dynamic = 'force-dynamic';
export default async function PlatformPage() {
  const status = await platformBackupStatus();
  if (!status) return <><PageHeader title="Platform" /><p>Only the platform owner can view these settings.</p></>;
  return <><PageHeader eyebrow="Platform settings" title="Backup status" /><BackupStatus status={status} /></>;
}
