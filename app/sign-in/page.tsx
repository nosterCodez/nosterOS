import { PageHeader } from '@/components/PageHeader';
import { SignInForm } from '@/components/AccountForms';
import { safeNext } from '@/lib/auth-boundary';

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  return <><PageHeader eyebrow="OmegaOS" title="Sign in" /><SignInForm next={safeNext(params.next)} google={Boolean(process.env.GOOGLE_LOGIN_CLIENT_ID && process.env.GOOGLE_LOGIN_CLIENT_SECRET)} /></>;
}
