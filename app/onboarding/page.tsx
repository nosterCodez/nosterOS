import { PageHeader } from '@/components/PageHeader';
import { OnboardingForm } from '@/components/AccountForms';
import { requireSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function Onboarding() {
  if (!await requireSession(undefined, true)) redirect('/sign-in?next=/onboarding');
  return <><PageHeader eyebrow="OmegaOS" title="Create a workspace" /><OnboardingForm /></>;
}
