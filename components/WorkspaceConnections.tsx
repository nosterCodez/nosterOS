'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Save, ShieldCheck, Unplug, RefreshCw } from 'lucide-react';
import type { ConnectionMetadata } from '@/lib/connection-fields';
import { GmailSetupHelp } from '@/components/GmailSetupHelp';
import { IMAP_HOSTS, VERIFICATION_LABELS, VERIFICATION_REJECTED, type EmailInput } from '@/lib/verification-types';

type Snapshot = { ready: boolean; connections: ConnectionMetadata[]; email?: Omit<EmailInput, 'password'> };
type Update = (body: object, method?: string) => Promise<void>;
const inputClass = 'min-w-0 w-full rounded border border-os-border bg-os-bg px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent disabled:opacity-50';
const buttonClass = 'flex items-center gap-2 rounded border border-os-border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 disabled:opacity-40';
function saved(connection: ConnectionMetadata) { return !['not_configured', 'revoked'].includes(connection.status); }
export function VerificationPill({ connection }: { connection: ConnectionMetadata }) {
  const color = connection.status === 'verified' ? 'text-os-ok' : connection.status === 'rejected' ? 'text-os-err' : ['unreachable', 'unverified', 'incomplete'].includes(connection.status) ? 'text-os-warn' : 'text-os-muted';
  const minutes = connection.checkedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(connection.checkedAt)) / 60000)) : null;
  const age = minutes === null ? null : minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
    <span className={`rounded border border-current px-2 py-1 ${color}`}>{VERIFICATION_LABELS[connection.status]}</span>
    {connection.note && <span className="text-os-muted">{connection.note}</span>}
    {age && <time dateTime={connection.checkedAt!} title={connection.checkedAt!} suppressHydrationWarning className="text-os-muted">Checked {age}</time>}
  </div>;
}
function ConnectionRow({ connection, ready, update, readOnly, initialEmail }: { connection: ConnectionMetadata; ready: boolean; update: Update; readOnly: boolean; initialEmail?: Omit<EmailInput, 'password'> }) {
  const email = connection.provider === 'email', name = email ? 'email' : connection.name;
  const [value, setValue] = useState('');
  const [host, setHost] = useState(initialEmail?.host || 'imap.gmail.com');
  const [account, setAccount] = useState(initialEmail?.account ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  async function act(action: 'save' | 'verify' | 'remove') {
    setBusy(action); setMessage('');
    const nextValue = value; if (action === 'save') setValue('');
    try {
      await update(action === 'verify' ? { name, action: 'verify' } : action === 'remove' ? { name } : email ? { name, email: { host, account, password: nextValue } } : { name, value: nextValue }, action === 'remove' ? 'DELETE' : 'POST');
      setMessage(action === 'save' ? 'Saved securely. See the check result above.' : action === 'verify' ? 'Check complete.' : 'Disconnected from this workspace.'); setConfirm(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection update failed'); }
    finally { setBusy(null); }
  }
  return <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (!readOnly) void act('save'); }} className="min-w-0 border-b border-os-border py-5 last:border-0">
    <h3 className="mb-3 text-sm font-semibold">{email ? 'Email inbox' : connection.label}</h3>
    <VerificationPill connection={connection} />
    {!readOnly && <>
      {email && <div className="mt-4 grid min-w-0 gap-3">
        <label className="text-xs">Email IMAP host<select value={host} onChange={event => setHost(event.target.value)} disabled={!ready || !!busy} className={`${inputClass} mt-1`} required><option value="">Choose provider</option>{IMAP_HOSTS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="text-xs">Email account<input type="email" autoComplete="username" value={account} onChange={event => setAccount(event.target.value)} disabled={!ready || !!busy} className={`${inputClass} mt-1`} maxLength={512} required /></label>
      </div>}
      <label htmlFor={`connection-${name}`} className="mt-4 block text-xs">{email ? 'App password (required to save)' : saved(connection) ? 'Replacement key' : 'Key'}</label>
      <input id={`connection-${name}`} type="password" autoComplete="new-password" spellCheck={false} value={value} onChange={event => setValue(event.target.value)} maxLength={4096} disabled={!ready || !!busy} required className={`${inputClass} mt-1`} />
      <div className="mt-3 flex min-w-0 flex-wrap gap-2">
        <button type="submit" title="Save and verify credentials" disabled={!ready || !!busy || !value.trim()} className={`pressable ${buttonClass} text-os-accent`}><Save size={16} aria-hidden="true" />{busy === 'save' ? 'Checking...' : 'Save & verify'}</button>
        {saved(connection) && <>
          <button type="button" title="Verify saved credentials" disabled={!ready || !!busy || connection.status === 'incomplete'} onClick={() => void act('verify')} className={`pressable ${buttonClass} ${connection.status === 'unverified' ? 'border-os-warn text-os-warn' : 'text-os-accent'}`}><RefreshCw size={16} aria-hidden="true" />{busy === 'verify' ? 'Checking...' : 'Verify'}</button>
          <button type="button" title="Disconnect credential" disabled={!!busy} onClick={() => setConfirm(!confirm)} className={`pressable ${buttonClass} text-os-muted`}><Unplug size={16} aria-hidden="true" /><span className="sr-only">Disconnect {email ? 'email' : connection.label}</span></button>
        </>}
      </div>
      {confirm && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>Stop using this connection in this workspace?</span><button type="button" disabled={!!busy} onClick={() => void act('remove')} className="pressable underline text-os-accent focus-visible:outline">Disconnect</button><button type="button" onClick={() => setConfirm(false)} className="pressable underline focus-visible:outline">Keep</button></div>}
      <p role="status" aria-live="polite" className="mt-2 text-xs text-os-muted">{message}</p>
    </>}
  </form>;
}
export function WorkspaceConnections({ initial, workspaceId, readOnly = false }: { initial: Snapshot; workspaceId: string; readOnly?: boolean }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  async function update(body: object, method = 'POST') {
    const response = await fetch('/api/admin/connections', { method, headers: { 'Content-Type': 'application/json', 'x-omegaos-workspace': workspaceId }, body: JSON.stringify(body) });
    if (response.status === 409) throw new Error('Connection or workspace changed. Reload Connections before saving.');
    if (response.status === 429) throw new Error('Wait one minute. This workspace allows five checks per minute.');
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const safeErrors = ['token rejected or missing shops.read', 'Printify unreachable, not saved', VERIFICATION_REJECTED, 'Complete email host, account and app password.'];
      throw new Error(safeErrors.includes(result?.error) ? result.error : response.status === 503 ? 'The vault is unavailable. Contact your administrator.' : 'Could not update this connection. Check your access and value.');
    }
    setSnapshot(await response.json() as Snapshot); router.refresh();
  }
  const providers = [...new Set(snapshot.connections.map(connection => connection.provider))];
  return <div className="min-w-0 max-w-5xl">
    <div className="mb-8 flex items-start gap-3 border-y border-os-border py-4"><ShieldCheck size={20} className="shrink-0 text-os-accent" aria-hidden="true" /><div className="min-w-0 text-sm leading-relaxed"><p>Credentials are encrypted and private to this workspace.</p><p className="mt-1 text-os-muted">Verification checks access, not every permission. Stripe needs Charges read for reporting. Removing a connection here does not revoke it at the provider.</p></div></div>
    {!snapshot.ready && !readOnly && <p role="alert" className="mb-6 border-l-2 border-os-warn pl-3 text-sm text-os-warn">The secure vault needs administrator setup before you can save credentials.</p>}
    <div className="grid min-w-0 gap-x-10 gap-y-8 md:grid-cols-2">
      {providers.map(provider => <section key={provider} id={provider === 'email' ? 'email-credentials' : provider === 'printify' ? 'printify-credentials' : undefined} className="min-w-0 scroll-mt-24" aria-labelledby={`provider-${provider}`}>
        <h2 id={`provider-${provider}`} className="flex items-center gap-2 border-b border-os-border pb-3 text-sm font-semibold uppercase"><KeyRound size={16} className="text-os-accent" aria-hidden="true" />{provider}</h2>
        {provider === 'email' && !readOnly && <GmailSetupHelp />}
        {provider === 'printify' && !readOnly && <p className="mt-3 text-xs leading-5 text-os-muted">Use a personal token with shops.read, products.read and orders.read. Saving checks shop access only. A saved Printify sign-in takes priority over this token. <a href="#source-printify" className="text-os-accent underline">Select your shop</a>.</p>}
        {snapshot.connections.filter(connection => connection.provider === provider && (provider !== 'email' || connection.name === 'INBOX_1_HOST')).map(connection => <ConnectionRow key={connection.name} connection={connection} ready={snapshot.ready} update={update} readOnly={readOnly} initialEmail={snapshot.email} />)}
      </section>)}
    </div>
  </div>;
}
