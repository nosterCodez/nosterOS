import { requireWorkspace, withWorkspaceLease } from '@/lib/session';
import { connectionMetadata, vaultReady } from '@/lib/creds';
import { PageHeader } from '@/components/PageHeader';
import { WorkspaceConnections } from '@/components/WorkspaceConnections';
import { CloudConnections } from '@/components/CloudConnections';
import { sourceView, sourceViews } from '@/lib/cloud-sources';

export const dynamic = 'force-dynamic';
export default async function IntegrationsPage({ searchParams }: { searchParams?: Promise<{ connection?: string }> } = {}) {
  const context = await requireWorkspace();
  if (!['admin', 'owner'].includes(context.role)) {
    const printify = await withWorkspaceLease(context, db => sourceView({ ...context, db }, 'printify'));
    return <><PageHeader eyebrow={context.workspace.name} title="Connections" /><p className="mb-5 text-os-muted">A workspace administrator manages your connections.</p><CloudConnections workspaceId={context.workspace.id} initial={[printify]} readOnly /></>;
  }
  const initial = await withWorkspaceLease(context, db => {
    const scoped = { ...context, db };
    return { ready: vaultReady(scoped), connections: connectionMetadata(scoped), sources: sourceViews(scoped) };
  });
  const result = (await searchParams)?.connection;
  return <><PageHeader eyebrow={context.workspace.name} title="Connections" />
    {result && <p role="status" className="mb-6 text-sm text-os-muted">{result === 'authorized' ? 'Connected. Your account connection is securely saved to this workspace. Choose what to report on below; automatic updates stay off until you enable them.' : 'Authorization did not complete. Check the account, app permissions and active workspace, then try again.'}</p>}
    <CloudConnections key={`sources:${context.workspace.id}`} workspaceId={context.workspace.id} initial={initial.sources} />
    <details id="credentials" className="mt-12 scroll-mt-24"><summary className="mb-5 cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-os-accent">Advanced connections</summary><WorkspaceConnections key={context.workspace.id} workspaceId={context.workspace.id} initial={initial} /></details></>;
}
