'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Save, ShieldCheck, Unplug } from 'lucide-react';
import type { ConnectionMetadata } from '@/lib/connection-fields';
import { GmailSetupHelp } from '@/components/GmailSetupHelp';
type Snapshot = { ready: boolean; connections: ConnectionMetadata[] };
const statusLabel = { saved: 'Saved / unverified', revoked: 'Disconnected', not_configured: 'Not configured' };
function ConnectionRow({ connection, ready, update }: { connection: ConnectionMetadata; ready: boolean; update: (method: string, body: object) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  async function act(method: string) {
    setBusy(true); setMessage('');
    const nextValue = value; setValue('');
    try { await update(method, method === 'POST' ? { name: connection.name, value: nextValue } : { name: connection.name }); setMessage(method === 'POST' ? connection.provider === 'printify' ? 'Saved securely. Shop access validated. Select your shop above to start reporting.' : 'Saved securely. Not yet verified with the provider.' : 'Disconnected from this workspace.'); setConfirm(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Connection update failed'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(event: FormEvent) => { event.preventDefault(); void act('POST'); }} className="min-w-0 border-b border-os-border py-5 last:border-0">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={`connection-${connection.name}`} className="text-sm font-semibold">{connection.label}</label>
      <span className="text-xs text-os-muted">{connection.provider === 'printify' ? connection.status === 'saved' ? 'Saved' : 'Not configured' : statusLabel[connection.status]}</span>
    </div>
    <div className="flex min-w-0 flex-wrap gap-2">
      <input id={`connection-${connection.name}`} type="password" autoComplete="new-password" spellCheck={false} value={value} onChange={event => setValue(event.target.value)} maxLength={4096} disabled={!ready || busy} placeholder={connection.status === 'saved' ? 'Enter replacement value' : 'Enter value'} required className="min-w-0 basis-44 flex-1 rounded border border-os-border bg-os-bg px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent disabled:opacity-50" />
      <button type="submit" title="Save credential" disabled={!ready || busy || !value.trim()} className="pressable flex items-center gap-2 rounded border border-os-border px-3 py-2 text-sm text-os-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-40"><Save size={16} aria-hidden="true" />{busy ? 'Saving...' : 'Save'}</button>
      {connection.status === 'saved' && <button type="button" title="Disconnect credential" disabled={busy} onClick={() => setConfirm(!confirm)} className="pressable rounded border border-os-border p-2 text-os-muted focus-visible:outline focus-visible:outline-2"><Unplug size={18} aria-hidden="true" /><span className="sr-only">Disconnect {connection.label}</span></button>}
    </div>
    {confirm && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>Stop using this credential in this workspace?</span><button type="button" disabled={busy} onClick={() => void act('DELETE')} className="pressable underline text-os-accent focus-visible:outline">Disconnect</button><button type="button" onClick={() => setConfirm(false)} className="pressable underline focus-visible:outline">Keep</button></div>}
    <p role="status" aria-live="polite" className="mt-2 text-xs text-os-muted">{message}</p>
  </form>;
}
export function WorkspaceConnections({ initial, workspaceId }: { initial: Snapshot; workspaceId: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  async function update(method: string, body: object) {
    const response = await fetch('/api/admin/connections', { method, headers: { 'Content-Type': 'application/json', 'x-omegaos-workspace': workspaceId }, body: JSON.stringify(body) });
    if (response.status === 409) throw new Error('Connection or workspace changed. Reload Connections before saving.');
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const safePrintifyErrors = ['token rejected or missing shops.read', 'Printify unreachable, not saved'];
      throw new Error(safePrintifyErrors.includes(result?.error) ? result.error : response.status === 503 ? 'The vault is unavailable. Contact your administrator.' : 'Could not update this connection. Check your access and value.');
    }
    setSnapshot(await response.json() as Snapshot);
    router.refresh();
  }
  const providers = [...new Set(snapshot.connections.map(connection => connection.provider))];
  return <div className="min-w-0 max-w-5xl">
    <div className="mb-8 flex items-start gap-3 border-y border-os-border py-4">
      <ShieldCheck size={20} className="shrink-0 text-os-accent" aria-hidden="true" />
      <div className="min-w-0 text-sm leading-relaxed"><p>Credentials are encrypted and private to this workspace.</p><p className="mt-1 text-os-muted">After saving a key, enable its source above. A saved key is not proof of provider access. Use a restricted read-only Stripe key with Charges read access. Removing a key here does not revoke it at the provider.</p></div>
    </div>
    {!snapshot.ready && <p role="alert" className="mb-6 border-l-2 border-os-warn pl-3 text-sm text-os-warn">The secure vault needs administrator setup before you can save credentials.</p>}
    <div className="grid min-w-0 gap-x-10 gap-y-8 md:grid-cols-2">
      {providers.map(provider => <section key={provider} id={provider === 'email' ? 'email-credentials' : provider === 'printify' ? 'printify-credentials' : undefined} className="min-w-0 scroll-mt-24" aria-labelledby={`provider-${provider}`}>
        <h2 id={`provider-${provider}`} className="flex items-center gap-2 border-b border-os-border pb-3 text-sm font-semibold uppercase"><KeyRound size={16} className="text-os-accent" aria-hidden="true" />{provider}</h2>
        {provider === 'email' && <GmailSetupHelp />}
        {provider === 'printify' && <p className="mt-3 text-xs leading-5 text-os-muted">Use a personal token with shops.read, products.read and orders.read. Saving checks shop access only. A saved Printify sign-in takes priority over this token. <a href="#source-printify" className="text-os-accent underline">Select your shop</a>.</p>}
        {snapshot.connections.filter(connection => connection.provider === provider).map(connection => <ConnectionRow key={connection.name} connection={connection} ready={snapshot.ready} update={update} />)}
      </section>)}
    </div>
  </div>;
}
