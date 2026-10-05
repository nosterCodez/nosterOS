import { PageHeader } from '@/components/PageHeader';
import { OnboardingForm, WorkspaceChooser } from '@/components/AccountForms';
import { requireSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth';

export default async function Onboarding({ searchParams }: { searchParams?: Promise<{ new?: string }> } = {}) {
  const h = new Headers(await headers());
  if (!await requireSession(h, true)) redirect('/sign-in?next=/onboarding');
  const auth = await getAuth();
  const workspaces = await auth.api.listOrganizations({ headers: h });
  const invitations = await auth.api.listUserInvitations({ headers: h });
  const pending = invitations.filter(i => i.status === 'pending' && new Date(i.expiresAt).getTime() > Date.now());
  const create = (await searchParams)?.new === '1';
  if (!create && (workspaces.length || pending.length)) return <><PageHeader eyebrow="OmegaOS" title="Your workspaces" />
    <WorkspaceChooser workspaces={workspaces.map(w => ({ id: w.id, name: w.name }))} />
    {pending.length > 0 && <section className="mt-8 space-y-3"><h2 className="text-lg">Your invitations</h2>{pending.map(i => <a className="block text-sm underline" key={i.id} href={`/accept-invitation?id=${encodeURIComponent(i.id)}`}>Review invitation to {i.organizationName}</a>)}</section>}
    <a className="mt-8 inline-block text-sm text-os-muted underline" href="/onboarding?new=1">Create a separate workspace</a></>;
  return <><PageHeader eyebrow="OmegaOS" title="Create a workspace" /><OnboardingForm />{workspaces.length > 0 && <a className="mt-6 inline-block underline" href="/onboarding">Back to existing workspaces</a>}</>;
}
