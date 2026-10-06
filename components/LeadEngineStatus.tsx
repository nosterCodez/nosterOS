'use client';
import { useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { LeadRunState } from '@/lib/leads/run-state';
export function LeadEngineStatus({ workspaceId, canRun, initial }: { workspaceId: string; canRun: boolean; initial: LeadRunState }) {
  const [state, setState] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function request(run: boolean) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/leads/runs', { method: run ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-omegaos-workspace': workspaceId }, ...(run ? { body: JSON.stringify({ action: 'run' }) } : {}) });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Unable to load runs.');
      setState(LeadRunState.parse(value)); setMessage(run ? 'Discovery queued for the next internal tick.' : 'Status updated.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load runs.'); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="lead-engine-title" className="mt-8 min-w-0 border-t border-os-border pt-6">
    <h2 id="lead-engine-title" className="text-lg font-bold">Discovery runs</h2>
    <p className="mt-2 text-sm text-os-muted">{state.enabled ? 'City-based candidate discovery. Scoring, radius filtering and outreach are not enabled in this release.' : 'Private beta. Discovery is disabled until this workspace is approved.'}</p>
    {state.enabled && !state.ready && <p className="mt-2 text-sm text-os-warn">Activate a plan for the current Business Profile, then refresh status.</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      {canRun && <button type="button" className="pressable inline-flex items-center gap-2 border border-os-border-strong px-3 py-2 text-sm disabled:opacity-50" disabled={busy || !state.enabled || !state.ready} onClick={() => request(true)}><Play size={16} aria-hidden="true" />Run now</button>}
      <button type="button" className="pressable inline-flex items-center gap-2 border border-os-border-strong px-3 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => request(false)}><RefreshCw size={16} aria-hidden="true" />Refresh runs</button>
    </div>
    <p role="status" className="mt-2 text-sm text-os-muted">{message}</p>
    <ul className="mt-3 divide-y divide-os-border">{state.runs.map(run => <li key={run.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{run.createdAt.replace('T', ' ').slice(0, 16)} UTC</span><span>{run.state} / {run.found} candidates / {run.jobs} steps</span></li>)}</ul>
    <p className="mt-4 text-xs text-os-muted">Sources: <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors (ODbL)</a>. <a className="underline" href="https://opensource.foursquare.com/os-places/" target="_blank" rel="noreferrer">Foursquare OS Places (Apache-2.0)</a> requires a local authorized import.</p>
  </section>;
}
