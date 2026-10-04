import { requireWorkspace, withWorkspaceLease } from '@/lib/session';
import { connectionMetadata, vaultReady } from '@/lib/creds';
import { PageHeader } from '@/components/PageHeader';
import { WorkspaceConnections } from '@/components/WorkspaceConnections';

export const dynamic = 'force-dynamic';
export default async function IntegrationsPage() {
  const context = await requireWorkspace();
  if (!['admin', 'owner'].includes(context.role)) return <><PageHeader title="Connections" /><p className="text-os-muted">A workspace administrator manages your connections.</p></>;
  const initial = await withWorkspaceLease(context, db => {
    const scoped = { ...context, db };
    return { ready: vaultReady(scoped), connections: connectionMetadata(scoped) };
  });
  return <><PageHeader eyebrow={context.workspace.name} title="Connections" /><WorkspaceConnections key={context.workspace.id} workspaceId={context.workspace.id} initial={initial} /></>;
}
