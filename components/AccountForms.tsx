'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export const accountField = 'w-full rounded-ctl border border-os-border bg-os-bg px-3 py-2 text-os-text';
export const accountButton = 'rounded-ctl border border-os-border px-4 py-2 text-sm hover:border-os-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent';

export function SignInForm({ next, google }: { next: string; google: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <form className="space-y-5" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setMessage('');
    const email = String(new FormData(e.currentTarget).get('email'));
    try {
      const result = await authClient.signIn.magicLink({ email, callbackURL: next }, { timeout: 20_000, retry: 0 });
      setMessage(result.error ? 'We could not send a sign-in link. Please wait a moment and try again.' : 'If this email belongs to an account or an approved invitation, a sign-in link is on its way. Check your inbox and spam folder.');
    } catch { setMessage('The request could not finish. Check your inbox before trying again.'); }
    finally { setBusy(false); }
  }}>
    <label className="block space-y-2"><span>Email address</span><input className={accountField} name="email" type="email" autoComplete="email" required /></label>
    <button className={`pressable ${accountButton}`} disabled={busy}>{busy ? 'Sending...' : 'Email a sign-in link'}</button>
    <button type="button" className={`pressable ${accountButton} block`} disabled={!google || busy} onClick={async () => {
      setBusy(true);
      try { const result = await authClient.signIn.social({ provider: 'google', callbackURL: next }); if (result.error) setMessage(result.error.message ?? 'Google sign-in failed.'); }
      catch { setMessage('Google sign-in unavailable.'); } finally { setBusy(false); }
    }}>Continue with Google</button>
    {!google && <p className="text-sm text-os-muted">Google sign-in is not configured yet.</p>}
    <p role="status" className="text-sm text-os-muted">{message}</p>
  </form>;
}

export function OnboardingForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <form className="space-y-5" onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      const result = await authClient.organization.create({ name: String(data.get('name')), slug: `workspace-${crypto.randomUUID()}`, metadata: { kind: data.get('kind') } });
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'Could not create workspace');
      const active = await authClient.organization.setActive({ organizationId: result.data.id });
      if (active.error) throw new Error(active.error.message);
      window.location.assign('/');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create workspace'); setBusy(false); }
  }}>
    <label className="block space-y-2"><span>Workspace name</span><input className={accountField} name="name" maxLength={100} required /></label>
    <label className="block space-y-2"><span>Workspace kind</span><select className={accountField} name="kind"><option value="founder">Founder</option><option value="agency">Agency</option><option value="client">Client</option></select></label>
    <button className={`pressable ${accountButton}`} disabled={busy}>{busy ? 'Creating...' : 'Create workspace'}</button>
    <p role="alert" className="text-sm text-os-muted">{message}</p>
  </form>;
}

export function WorkspaceChooser({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="space-y-3">{workspaces.map(workspace => <button key={workspace.id} type="button" disabled={busy} className={`pressable ${accountButton} w-full break-words text-left`} onClick={async () => {
    setBusy(true); setError('');
    try { const result = await authClient.organization.setActive({ organizationId: workspace.id }); if (result.error) throw new Error('This workspace is no longer available.'); window.location.assign('/'); }
    catch { setError('Unable to open that workspace. Reload and try again.'); setBusy(false); }
  }}>{workspace.name}</button>)}<p role="alert" className="text-sm text-os-muted">{error}</p></div>;
}

export function AcceptInvitation({ id, signedIn, email }: { id: string; signedIn: boolean; email?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!signedIn) return <a className={`pressable ${accountButton}`} href={`/sign-in?next=${encodeURIComponent(`/accept-invitation?id=${encodeURIComponent(id)}`)}`}>Sign in to accept invitation</a>;
  return <div className="space-y-4"><p className="break-words text-sm text-os-muted">Signed in as {email}. Use the email address that received the invitation.</p><button className={`pressable ${accountButton}`} disabled={!id || busy} onClick={async () => {
    setBusy(true);
    try {
      const result = await authClient.organization.acceptInvitation({ invitationId: id });
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'Invitation is unavailable');
      const active = await authClient.organization.setActive({ organizationId: result.data.invitation.organizationId });
      if (active.error) throw new Error(active.error.message);
      window.location.assign('/');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to accept invitation'); setBusy(false); }
  }}>Accept workspace invitation</button><button type="button" className={`pressable ${accountButton} block`} disabled={busy} onClick={async () => {
    setBusy(true);
    try { const result = await authClient.signOut(); if (result.error) throw new Error(); window.location.assign(`/sign-in?next=${encodeURIComponent(`/accept-invitation?id=${encodeURIComponent(id)}`)}`); }
    catch { setMessage('Unable to switch accounts. Try again.'); setBusy(false); }
  }}>Use another email</button><p role="alert">{message}</p></div>;
}
