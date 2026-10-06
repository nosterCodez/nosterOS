import { PageHeader } from '@/components/PageHeader';
import { BusinessProfileEditor } from '@/components/BusinessProfileEditor';
import { requireWorkspace, withWorkspaceLease } from '@/lib/session';
export const dynamic = 'force-dynamic';
export default async function BusinessProfilePage() {
  const context = await requireWorkspace();
  const data = await withWorkspaceLease(context, db => ({ current: db.businessProfiles.current(), versions: db.businessProfiles.list() }));
  return <div className="mx-auto w-full min-w-0 max-w-4xl"><PageHeader title="Business profile" eyebrow="Workspace settings" />
    <BusinessProfileEditor key={context.workspace.id} workspaceId={context.workspace.id} canEdit={context.role !== 'viewer'} {...data} />
  </div>;
}
