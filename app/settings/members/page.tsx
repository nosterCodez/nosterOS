import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { requireSession } from '@/lib/session';
import { PageHeader } from '@/components/PageHeader';
import { WorkspaceMembers } from '@/components/WorkspaceMembers';

export default async function Members() {
  const h = new Headers(await headers());
  const session = await requireSession(h, true);
  if (!session) redirect('/sign-in?next=/settings/members');
  if (!session.session.activeOrganizationId) redirect('/onboarding');
  const auth = await getAuth();
  const member = await auth.api.getActiveMember({ headers: h });
  if (!['owner', 'admin'].includes(member.role)) return <><PageHeader title="Members" /><p>Only workspace owners and admins can manage members.</p></>;
  const workspace = await auth.api.getFullOrganization({ headers: h });
  return <><PageHeader eyebrow="Workspace settings" title="Members" /><WorkspaceMembers members={workspace?.members ?? []} invitations={workspace?.invitations ?? []} /></>;
}
