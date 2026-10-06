import { PageHeader } from '@/components/PageHeader';
import { LeadPlanEditor } from '@/components/LeadPlanEditor';
import { requireWorkspace, withWorkspaceLease } from '@/lib/session';
import { leadPlanState } from '@/lib/leads/state';
export const dynamic = 'force-dynamic';
export default async function LeadPlanPage() {
  const context = await requireWorkspace();
  const initial = await withWorkspaceLease(context, leadPlanState);
  return <div className="mx-auto w-full min-w-0 max-w-4xl"><PageHeader title="Lead plan" eyebrow="Workspace" />
    <LeadPlanEditor key={context.workspace.id} workspaceId={context.workspace.id} canEdit={context.role !== 'viewer'} canActivate={['owner', 'admin'].includes(context.role)} initial={initial} />
  </div>;
}
