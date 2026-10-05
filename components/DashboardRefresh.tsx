'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
export function DashboardRefresh() {
  const router = useRouter(), [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') startTransition(() => router.refresh()); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [router]);
  return <button type="button" title="Reload saved dashboard data" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="pressable inline-flex items-center gap-2 text-sm text-os-accent disabled:opacity-50"><RefreshCw size={15} className={pending ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh dashboard</button>;
}
export function SourceSync({ id, workspaceId }: { id: string; workspaceId: string }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <div className="mt-3"><button disabled={busy} type="button" className="pressable inline-flex items-center gap-2 text-xs text-os-accent disabled:opacity-50" onClick={async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/sources', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-omegaos-workspace': workspaceId }, body: JSON.stringify({ action: 'sync', id }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to sync.');
      setMessage(data.outcome?.ok ? 'Account data refreshed.' : data.outcome?.error || data.outcome?.skipped || 'No update available.'); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to sync. Please retry.'); }
    finally { setBusy(false); }
  }}><RefreshCw size={14} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} />{busy ? 'Syncing...' : 'Sync now'}</button><p role="status" className="mt-2 text-xs text-os-muted">{message}</p></div>;
}
