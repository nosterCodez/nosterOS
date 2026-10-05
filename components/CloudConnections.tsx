'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Link2, RefreshCw, Save, Unplug } from 'lucide-react';
import type { CloudSourceView } from '@/lib/cloud-sources';

export const SOURCE_STATUS: Record<string, string> = { planned: 'Planned', vault_unavailable: 'Vault unavailable', not_connected: 'Not connected', needs_setup: 'Choose settings', paused: 'Paused', error: 'Needs attention', stale: 'Data is stale', connected: 'Up to date', ready: 'Ready to sync' };
const control = 'pressable flex items-center justify-center gap-2 rounded border border-os-border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent disabled:opacity-40';
function SourceRow({ source, act }: { source: CloudSourceView; act: (body: object) => Promise<string> }) {
  const [resource, setResource] = useState(source.resource), [enabled, setEnabled] = useState(source.enabled), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(false);
  useEffect(() => { setResource(source.resource); setEnabled(source.enabled); }, [source.resource, source.enabled]);
  async function run(body: object) {
    setBusy(true); setMessage('');
    try { setMessage(await act(body)); setConfirm(false); } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to update connection.'); }
    finally { setBusy(false); }
  }
  return <section aria-label={source.name} className="min-w-0 rounded border border-os-border p-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-base font-semibold">{source.name}</h2><span className={`text-xs ${['error','stale'].includes(source.status) ? 'text-os-warn' : 'text-os-muted'}`}>{SOURCE_STATUS[source.status]}</span></div>
    <p className="mt-3 text-xs leading-6 text-os-muted">{source.note}</p>
    {!source.planned && <>
      {source.provider && <div className="mt-4"><button type="button" className={`${control} pressable`} disabled={busy || !source.appReady} onClick={() => void run({ action: 'authorize', id: source.provider })}><Link2 size={15} aria-hidden="true" />{['not_connected','vault_unavailable'].includes(source.status) ? 'Authorize account' : 'Reconnect account'}<ArrowUpRight size={14} aria-hidden="true" /></button>{!source.appReady && <p className="mt-2 text-xs text-os-warn">Administrator setup required: developer app and approved permissions.</p>}</div>}
      {!source.provider && <a href="#credentials" className="mt-4 inline-flex items-center gap-2 text-xs text-os-accent underline">Manage {source.id === 'email' ? 'inbox credentials' : 'restricted key'}<ArrowUpRight size={14} aria-hidden="true" /></a>}
      <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void run({ action: 'configure', id: source.id, resource, enabled }); }}>
        {source.resourceLabel && <label className="block text-xs"><span>{source.resourceLabel}</span><input value={resource} onChange={event => setResource(event.target.value)} maxLength={500} required disabled={busy} className="mt-2 w-full min-w-0 rounded border border-os-border bg-os-bg p-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent" /></label>}
        <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy} />Automatically read these account metrics every 15 minutes.</label>
        <div className="flex flex-wrap gap-2"><button type="submit" className={`${control} pressable`} disabled={busy}><Save size={15} aria-hidden="true" />Save settings</button><button type="button" className={`${control} pressable`} disabled={busy || !source.enabled || ['not_connected','needs_setup','vault_unavailable'].includes(source.status)} onClick={() => void run({ action: 'sync', id: source.id })}><RefreshCw size={15} aria-hidden="true" />Sync now</button><button type="button" title={`Disconnect ${source.name}`} aria-label={`Disconnect ${source.name}`} className={`${control} pressable`} disabled={busy} onClick={() => setConfirm(!confirm)}><Unplug size={15} aria-hidden="true" /></button></div>
      </form>
      {confirm && <div className="mt-4 border-t border-os-border pt-3 text-xs leading-5"><p>{source.provider ? 'Disconnect this provider from this workspace? Other sources using the same provider will also stop. Revoke access at the provider separately.' : 'Stop automatic collection? Your stored key stays in Credentials until you remove it there.'}</p><div className="mt-2 flex gap-3"><button className="pressable underline" disabled={busy} onClick={() => void run({ action: 'disconnect', id: source.id })}>Confirm disconnect</button><button className="pressable underline" onClick={() => setConfirm(false)}>Keep</button></div></div>}
      {source.error && <p className="mt-3 text-xs text-os-warn">{source.error}</p>}
      <p role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-os-muted">{busy ? 'Working...' : message}</p>
    </>}
  </section>;
}
export function CloudConnections({ initial, workspaceId }: { initial: CloudSourceView[]; workspaceId: string }) {
  const [sources, setSources] = useState(initial), [group, setGroup] = useState('All');
  useEffect(() => setSources(initial), [initial]);
  async function act(body: object) {
    const response = await fetch('/api/admin/sources', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-omegaos-workspace': workspaceId }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? 'Workspace changed. Reload before continuing.' : result.error ?? 'Connection update failed.');
    if (result.url) { window.location.assign(result.url); return 'Opening account authorization...'; }
    setSources(result.sources);
    return result.outcome?.error ?? result.outcome?.skipped ?? (result.outcome?.ok ? 'Sync complete.' : 'Settings saved.');
  }
  return <div className="min-w-0 max-w-6xl">
    <div role="group" aria-label="Filter connections" className="mb-5 flex flex-wrap gap-2">{['All','Search','Money','Social','Email','Ads'].map(name => <button type="button" key={name} aria-pressed={group === name} onClick={() => setGroup(name)} className={`pressable ${control} ${group === name ? 'text-os-accent border-os-accent' : 'text-os-muted'}`}>{name}</button>)}</div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">{sources.filter(s => group === 'All' || s.group === group).map(source => <SourceRow key={`${workspaceId}:${source.id}`} source={source} act={act} />)}</div>
  </div>;
}
