'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PlacesImportView } from '@/lib/leads/places-portal-job';

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/** Platform-owner panel for the manual RGV Places Portal import. Nothing here runs automatically. */
export function PlacesImportPanel({ workspaceId, initial }: { workspaceId: string; initial: PlacesImportView }) {
  const [view, setView] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { 'content-type': 'application/json', 'x-omegaos-workspace': workspaceId };

  const refresh = useCallback(async () => {
    const response = await fetch('/api/platform/places-import', { headers: { 'x-omegaos-workspace': workspaceId }, cache: 'no-store' });
    if (response.ok) setView(await response.json());
  }, [workspaceId]);

  useEffect(() => {
    if (!view.running) return;
    const timer = setInterval(() => { refresh().catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [view.running, refresh]);

  async function start(replace: boolean) {
    setBusy(true); setError(''); setConfirming(false);
    try {
      const response = await fetch('/api/platform/places-import', { method: 'POST', headers, body: JSON.stringify({ action: 'import', replace }) });
      const body = await response.json();
      if (!response.ok) setError(body.error ?? 'Unable to start the import.');
      if (body.current !== undefined) setView(body);
    } catch { setError('Unable to start the import. Reload and try again.'); }
    finally { setBusy(false); }
  }

  const { current, last, running } = view;
  return <section aria-labelledby="places-heading" className="border-t border-os-border py-6">
    <h2 id="places-heading" className="text-lg font-semibold">RGV places import</h2>
    <p className="mt-1 max-w-2xl text-sm text-os-muted">Pulls open businesses inside the Rio Grande Valley from the Foursquare Places Portal into the shared places list that lead discovery reads. It runs only when you press the button.</p>
    <dl className="mt-4 grid grid-cols-1 gap-6 text-sm sm:grid-cols-3">
      <div><dt className="text-os-muted">Current import</dt><dd className="mt-2">{current ? `${current.count.toLocaleString()} places` : 'None imported'}</dd></div>
      <div><dt className="text-os-muted">Imported on</dt><dd className="mt-2">{current?.releaseDate ?? 'Not imported'}</dd></div>
      <div><dt className="text-os-muted">Size</dt><dd className="mt-2">{current ? mib(current.bytes) : 'Unknown'}</dd></div>
    </dl>
    {running && <p className="mt-5 text-sm text-os-muted" role="status">Import running since {last?.startedAt ?? 'just now'}. This can take several minutes; the page checks again every few seconds.</p>}
    {!running && last?.state === 'succeeded' && <p className="mt-5 text-sm text-os-ok" role="status">Last import finished {last.finishedAt}: {last.count?.toLocaleString()} places.</p>}
    {!running && (last?.state === 'failed' || last?.state === 'interrupted') && <p className="mt-5 text-sm text-os-warn" role="status">Last import {last.state === 'interrupted' ? 'was interrupted. Nothing was changed.' : `failed: ${last.message ?? 'Nothing was changed.'}`}</p>}
    {error && <p className="mt-3 text-sm text-os-err" role="alert">{error}</p>}
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {!confirming && <button type="button" className="pressable border border-os-border-strong px-4 py-2 text-sm" disabled={running || busy}
        onClick={() => current ? setConfirming(true) : start(false)}>{current ? 'Replace RGV import…' : 'Import RGV places'}</button>}
      {confirming && current && <div className="border border-os-warn p-4 text-sm" role="alertdialog" aria-labelledby="replace-title">
        <p id="replace-title">Replace the current {current.count.toLocaleString()} places (imported {current.releaseDate})? The old list stays in place until the new one is complete.</p>
        <div className="mt-3 flex gap-3">
          <button type="button" className="pressable border border-os-warn px-4 py-2" disabled={busy} onClick={() => start(true)}>Replace import</button>
          <button type="button" className="pressable border border-os-border px-4 py-2" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </div>}
    </div>
    <p className="mt-5 text-xs text-os-muted">Source: Foursquare OS Places, Apache-2.0. Public business fields only. Limits: 10 minutes, 60 MiB.</p>
  </section>;
}
