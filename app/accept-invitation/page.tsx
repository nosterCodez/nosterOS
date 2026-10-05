import { PageHeader } from '@/components/PageHeader';
import { AcceptInvitation } from '@/components/AccountForms';
import { requireSession } from '@/lib/session';

export default async function Invitation({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id = '' } = await searchParams;
  const session = await requireSession(undefined, true);
  return <><PageHeader eyebrow="OmegaOS" title="Workspace invitation" /><AcceptInvitation id={id} signedIn={Boolean(session)} email={session?.user.email} /></>;
}
