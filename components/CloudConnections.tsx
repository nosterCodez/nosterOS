'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Link2, RefreshCw, Save, Unplug } from 'lucide-react';
import type { CloudSourceView } from '@/lib/cloud-sources';
import type { ResourceDiscovery } from '@/lib/cloud-resources';
import { GmailSetupHelp } from '@/components/GmailSetupHelp';

export const SOURCE_STATUS: Record<string, string> = { planned: 'Coming later', vault_unavailable: 'Unavailable', not_connected: 'Not connected', needs_setup: 'Choose account', paused: 'Paused', error: 'Needs attention', stale: 'Data is stale', connected: 'Up to date', ready: 'Ready to sync' };
const control = 'flex items-center justify-center gap-2 rounded border border-os-border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent disabled:opacity-40';
const field = 'mt-2 w-full min-w-0 rounded border border-os-border bg-os-bg p-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent';
const providers: Record<string, string> = { google: 'Google', meta: 'Facebook', tiktok: 'TikTok', etsy: 'Etsy' };
const pickerNames: Record<string, string> = { 'search-console': 'Website', ga4: 'Analytics property', youtube: 'YouTube channel' };
type Result = Partial<ResourceDiscovery> & { message?: string };
type Act = (body: object) => Promise<Result>;

function SourceRow({ source, act }: { source: CloudSourceView; act: Act }) {
  const [resource, setResource] = useState(source.resource), [enabled, setEnabled] = useState(source.enabled);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(false);
  const [discovery, setDiscovery] = useState<ResourceDiscovery | null>(null);
  const authorized = !['not_connected', 'vault_unavailable', 'planned'].includes(source.status);
  const picker = pickerNames[source.id];
  const setupPending = source.provider && !source.planned && !source.appReady && source.status !== 'vault_unavailable';
  const accountSaved = Boolean(source.provider && authorized);
  const connectionLabel = setupPending ? 'Provider setup required' : accountSaved && !['error', 'stale'].includes(source.status) ? 'Connected' : SOURCE_STATUS[source.status];
  useEffect(() => { setResource(source.resource); setEnabled(source.enabled); }, [source.resource, source.enabled]);
  useEffect(() => { if (!authorized) setDiscovery(null); }, [authorized]);
  async function run(body: object, discover = false) {
    setBusy(true); setMessage('');
    if (discover) setDiscovery(null);
    try {
      const result = await act(body);
      if (discover && result.resources) setDiscovery({ resources: result.resources, truncated: Boolean(result.truncated) });
      setMessage(result.message ?? ''); setConfirm(false);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to update connection.'); }
    finally { setBusy(false); }
  }
  return <section id={`source-${source.id}`} aria-label={source.name} className="min-w-0 scroll-mt-24 rounded border border-os-border p-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-base font-semibold">{source.name}</h2><span className={`text-xs ${setupPending || ['error', 'stale'].includes(source.status) ? 'text-os-warn' : 'text-os-muted'}`}>{connectionLabel}</span></div>
    {accountSaved && <p className="mt-3 text-xs leading-5 text-os-muted">Account connection saved to this workspace. Reporting: {SOURCE_STATUS[source.status]}.</p>}
    <details className="mt-3 text-xs leading-6 text-os-muted"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-os-accent">Data and permissions</summary><p className="mt-2">{source.note}</p></details>
    {!source.planned && <>
      {source.provider ? <div className="mt-4">
        {source.status === 'vault_unavailable' ? <p className="text-xs leading-5 text-os-warn">Secure storage is unavailable. An OmegaOS administrator needs to restore it before connecting accounts.</p> : source.appReady ? <button type="button" className={`pressable ${control} text-os-accent`} disabled={busy} onClick={() => void run({ action: 'authorize', id: source.provider })}>
          <Link2 size={15} aria-hidden="true" />{authorized ? 'Reconnect' : 'Continue with'} {providers[source.provider] ?? source.name}<ArrowUpRight size={14} aria-hidden="true" />
        </button> : <p className="text-xs leading-5 text-os-muted">OmegaOS needs a one-time provider setup before account sign-in is available. This is not a problem with your account.</p>}
      </div> : <div className="mt-4 text-xs leading-5 text-os-muted">
        <p>Account sign-in is not available yet.</p>
        {source.id === 'email' && <GmailSetupHelp />}
        <a href={source.id === 'email' ? '#email-credentials' : '#credentials'} className="mt-3 inline-flex items-center gap-2 text-os-accent underline" onClick={() => { const panel = document.getElementById('credentials'); if (panel instanceof HTMLDetailsElement) panel.open = true; }}>{source.id === 'email' ? 'Enter email settings' : 'Advanced setup'}<ArrowUpRight size={14} aria-hidden="true" /></a>
      </div>}
      {authorized && <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void run({ action: 'configure', id: source.id, resource, enabled }); }}>
        {picker && <div className="space-y-3">
          <button type="button" className={`pressable ${control}`} disabled={busy} onClick={() => void run({ action: 'resources', id: source.id }, true)}><RefreshCw size={15} aria-hidden="true" />{discovery ? 'Refresh accounts' : 'Find accounts'}</button>
          {discovery && <>
            {discovery.resources.length > 0 ? <label className="block text-xs">{picker}<select className={field} value={resource} onChange={event => setResource(event.target.value)} disabled={busy} required>
              <option value="">Choose an account</option>
              {resource && !discovery.resources.some(r => r.id === resource) && <option value={resource}>Saved selection: {resource}</option>}
              {discovery.resources.map(r => <option key={r.id} value={r.id}>{r.label} ({r.id})</option>)}
            </select></label> : <p className="text-xs leading-5 text-os-muted">No accessible accounts found. Check your permissions or reconnect with another account.</p>}
            {discovery.truncated && <p className="text-xs text-os-warn">Only the first results are shown. Use a known account ID below if yours is missing.</p>}
          </>}
          {!discovery && resource && <p className="break-all text-xs text-os-muted">Selected: {resource}</p>}
        </div>}
        {source.resourceLabel && <details className="text-xs leading-5"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-os-accent">{picker ? 'Advanced account selection' : 'Account settings'}</summary><label className="mt-2 block">{source.resourceLabel}<input value={resource} onChange={event => setResource(event.target.value)} maxLength={500} disabled={busy} className={field} /></label></details>}
        <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy} />Automatically read these account metrics every 15 minutes.</label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={`pressable ${control}`} disabled={busy || Boolean(source.resourceLabel && !resource)}><Save size={15} aria-hidden="true" />Save settings</button>
          <button type="button" className={`pressable ${control}`} disabled={busy || source.status === 'needs_setup' || resource !== source.resource || enabled !== source.enabled} onClick={() => void run({ action: 'sync', id: source.id })}><RefreshCw size={15} aria-hidden="true" />Sync now</button>
          <button type="button" title={`Disconnect ${source.name}`} aria-label={`Disconnect ${source.name}`} className={`pressable ${control}`} disabled={busy} onClick={() => setConfirm(!confirm)}><Unplug size={15} aria-hidden="true" /></button>
        </div>
      </form>}
      {confirm && <div className="mt-4 border-t border-os-border pt-3 text-xs leading-5"><p>{source.provider ? 'Disconnect this provider from this workspace? Other sources using the same provider will also stop. Revoke access at the provider separately.' : 'Stop automatic collection? Your stored credentials stay in Advanced connections until removed.'}</p><div className="mt-2 flex gap-3"><button className="pressable underline" disabled={busy} onClick={() => void run({ action: 'disconnect', id: source.id })}>Confirm disconnect</button><button className="pressable underline" onClick={() => setConfirm(false)}>Keep</button></div></div>}
      {source.error && <p className="mt-3 text-xs text-os-warn">{source.error}</p>}
      <p role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-os-muted">{busy ? 'Working...' : message}</p>
    </>}
  </section>;
}

export function CloudConnections({ initial, workspaceId }: { initial: CloudSourceView[]; workspaceId: string }) {
  const [sources, setSources] = useState(initial), [group, setGroup] = useState('All');
  useEffect(() => setSources(initial), [initial]);
  const filtered = sources.filter(s => group === 'All' || s.group === group);
  const unavailable = (s: CloudSourceView) => s.planned || Boolean(s.provider && !s.appReady && s.status === 'not_connected');
  const availableSources = filtered.filter(s => !unavailable(s));
  const upcomingSources = filtered.filter(unavailable);
  async function act(body: object): Promise<Result> {
    const response = await fetch('/api/admin/sources', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-omegaos-workspace': workspaceId }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? 'Workspace changed. Reload before continuing.' : result.error ?? 'Connection update failed.');
    if (result.url) { window.location.assign(result.url); return { message: 'Opening account sign-in...' }; }
    if (result.resources) return { resources: result.resources, truncated: result.truncated };
    if (result.sources) setSources(result.sources);
    return { message: result.outcome?.error ?? result.outcome?.skipped ?? (result.outcome?.ok ? 'Sync complete.' : 'Settings saved.') };
  }
  return <div className="min-w-0 max-w-6xl">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Filter connections" className="flex flex-wrap gap-2">{['All', 'Search', 'Money', 'Social', 'Email', 'Ads'].map(name => <button type="button" key={name} aria-pressed={group === name} onClick={() => setGroup(name)} className={`pressable ${control} ${group === name ? 'text-os-accent border-os-accent' : 'text-os-muted'}`}>{name}</button>)}</div>
      <button type="button" className={`pressable ${control}`} onClick={() => window.location.reload()}><RefreshCw size={15} aria-hidden="true" />Refresh status</button>
    </div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">{availableSources.map(source => <SourceRow key={`${workspaceId}:${source.id}`} source={source} act={act} />)}</div>
    {!availableSources.length && <p className="text-sm text-os-muted">No connectors are ready in this category yet.</p>}
    {upcomingSources.length > 0 && <details className="mt-8 border-t border-os-border pt-5">
      <summary className="cursor-pointer text-sm focus-visible:outline focus-visible:outline-os-accent">More connectors ({upcomingSources.length})</summary>
      <p className="my-4 text-xs leading-5 text-os-muted">These providers need platform setup or are still in development. Account sign-in is not available for them yet.</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">{upcomingSources.map(source => <SourceRow key={`${workspaceId}:${source.id}`} source={source} act={act} />)}</div>
    </details>}
  </div>;
}
