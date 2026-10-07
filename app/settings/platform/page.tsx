import { PageHeader } from '@/components/PageHeader';
import { BackupStatus } from '@/components/BackupStatus';
import { PlacesImportPanel } from '@/components/PlacesImportPanel';
import { platformBackupStatus } from '@/lib/backup/status';
import { placesImportView } from '@/lib/leads/places-portal-job';
import { dataDir } from '@/lib/paths';
import { operatorWorkspaceForPage } from '@/lib/session';
import { OperatorUnavailable } from '@/components/OperatorUnavailable';
export const dynamic = 'force-dynamic';
export default async function PlatformPage() {
  const workspace = await operatorWorkspaceForPage();
  if (!workspace) return <OperatorUnavailable />;
  // platformBackupStatus returns null for anyone but the platform owner; the import panel shares that gate.
  const status = await platformBackupStatus();
  if (!status) return <><PageHeader title="Platform" /><p>Only the platform owner can view these settings.</p></>;
  return <><PageHeader eyebrow="Platform settings" title="Backup status" /><BackupStatus status={status} />
    <PlacesImportPanel workspaceId={workspace.workspace.id} initial={placesImportView(dataDir())} /></>;
}
