import Link from 'next/link';
import { ArrowUpRight, Database, Link2 } from 'lucide-react';
import { requireWorkspace, withWorkspaceLease } from '@/lib/session';
import { sourceViews } from '@/lib/cloud-sources';
import { PageHeader } from '@/components/PageHeader';

export async function WorkspaceDashboard({ group }: { group?: string } = {}) {
  const context = await requireWorkspace();
  const sources = await withWorkspaceLease(context, db => sourceViews({ ...context, db }));
  const shown = sources.filter(s => !s.planned && (!group || s.group === group));
  const reporting = shown.filter(s => s.snapshot).length;
  return <div className="min-w-0 max-w-6xl">
    <PageHeader eyebrow={context.workspace.name} title={group ? `${group} overview` : 'Business overview'} />
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-y border-os-border py-4"><p className="flex items-center gap-2 text-sm text-os-muted"><Database size={17} aria-hidden="true" />{reporting} of {shown.length} sources reporting</p><Link href="/integrations" className="flex items-center gap-2 text-sm text-os-accent"><Link2 size={16} aria-hidden="true" />Manage connections<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
    <nav aria-label="Dashboard views" className="mb-8 flex flex-wrap gap-5 text-sm"><Link href="/">Overview</Link><Link href="/analytics">Search</Link><Link href="/finances">Money</Link><Link href="/social">Social</Link><Link href="/integrations">Connections</Link></nav>
    {reporting === 0 && <p className="mb-8 border-l-2 border-os-accent pl-4 text-sm leading-6 text-os-muted">No collected data yet. Choose an account in Connections, save its settings, then select Sync now. Automatic updates are optional. Missing data is never counted as zero.</p>}
    <div className="space-y-10">{shown.map(source => <section key={source.id} aria-label={source.name} className="min-w-0 border-t border-os-border pt-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-base font-semibold">{source.name}{source.snapshot?.mode === 'test' && <span className="ml-3 text-xs text-os-warn">TEST DATA</span>}</h2><span className={`text-xs ${source.error || source.stale ? 'text-os-warn' : 'text-os-muted'}`}>{source.error ? 'Needs attention' : source.snapshot ? source.stale ? 'Stale' : source.enabled ? 'Up to date' : 'Automatic updates off' : source.status === 'paused' || source.status === 'ready' ? 'Ready for first sync' : source.status === 'needs_setup' ? 'Choose account' : source.status === 'vault_unavailable' ? 'Secure storage unavailable' : 'Not connected'}</span></div>
      {!source.snapshot && <Link href={`/integrations#source-${source.id}`} className="mb-4 inline-flex items-center gap-2 text-xs text-os-accent underline">{source.status === 'paused' || source.status === 'ready' ? 'Load account data' : 'Set up connection'}<ArrowUpRight size={14} aria-hidden="true" /></Link>}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{source.metrics.map(metric => {
        const value = source.snapshot?.values[metric.id];
        const formatted = value == null ? '--' : metric.unit === 'usd' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : new Intl.NumberFormat('en-US', { maximumFractionDigits: metric.unit === 'count' ? 0 : 2 }).format(value) + (metric.unit === 'percent' ? '%' : '');
        return <div key={metric.id} className="min-w-0 border-l border-os-border pl-4"><p className="text-xs leading-5 text-os-muted">{metric.label}</p><p className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatted}</p></div>;
      })}</div>
      <p className="mt-4 text-xs leading-5 text-os-muted">{source.snapshot?.period ?? source.note}</p>
      {source.snapshot && <p className="mt-1 text-xs text-os-dim">Collected <time dateTime={source.snapshot.at}>{new Date(source.snapshot.at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</time></p>}
      {source.error && <p className="mt-2 text-xs text-os-warn">{source.error}</p>}
    </section>)}</div>
  </div>;
}
