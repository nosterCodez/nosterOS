import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { BackupStatus } from '@/components/BackupStatus';
import { PlacesImportPanel } from '@/components/PlacesImportPanel';
import { platformBackupStatus } from '@/lib/backup/status';
import { placesImportView } from '@/lib/leads/places-portal-job';
import { dataDir } from '@/lib/paths';
import { platformOwnerForPage } from '@/lib/platform-owner';
export const dynamic = 'force-dynamic';
/**
 * Platform owner only, whatever NOSTEROS_OPERATOR_FEATURES is (Claude review, Oct 7).
 * Only Backup status and the RGV places import live here; no host or operator connectors.
 */
export default async function PlatformPage() {
  const owner = await platformOwnerForPage();
  if (!owner) notFound();
  const status = await platformBackupStatus();
  if (!status) notFound();
  return <><PageHeader eyebrow="Platform settings" title="Backup status" /><BackupStatus status={status} />
    <PlacesImportPanel workspaceId={owner.workspace.id} initial={placesImportView(dataDir())} /></>;
}
