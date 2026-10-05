'use client';
import { useRef, useState } from 'react';
import { Download, Upload, Check } from 'lucide-react';
import { MAX_CSV_BYTES, type FinancialRow, type ImportFormat } from '@/lib/financial-csv';
import type { ImportSummary } from '@/lib/financial-imports';
const money = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const field = 'mt-2 block w-full min-w-0 rounded border border-os-border bg-os-bg p-3 text-sm text-os-text';
export function FinancialImports({ initial, workspaceId, canImport }: { initial: ImportSummary[]; workspaceId: string; canImport: boolean }) {
  const [summaries, setSummaries] = useState(initial), [format, setFormat] = useState<ImportFormat>('standard'), [account, setAccount] = useState('');
  const [csv, setCsv] = useState(''), [month, setMonth] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ rows: FinancialRow[]; count: number; excluded: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null), selection = useRef(0);
  async function request(action: 'preview' | 'save') {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/finances/imports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-omegaos-workspace': workspaceId }, body: JSON.stringify({ action, format, account, csv }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Import failed.');
      if (action === 'preview') setPreview(data);
      else { setSummaries(data.summaries); setMonth(''); setPreview(null); setCsv(''); if (fileRef.current) fileRef.current.value = ''; setMessage(`Imported ${data.inserted} transactions; ${data.duplicates} duplicates skipped. ${data.excluded} non-completed rows excluded.`); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed. Please retry.'); }
    finally { setBusy(false); }
  }
  async function filter(value: string) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/finances/imports?month=${encodeURIComponent(value)}`, { headers: { 'x-omegaos-workspace': workspaceId } });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load imports.'); setSummaries(data.summaries); setMonth(value);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load imports.'); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="import-title" className="mb-10 min-w-0 border-y border-os-border py-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs text-os-warn">MANUAL CSV DATA</p><h2 id="import-title" className="mt-2 text-lg font-semibold">Imported transactions</h2></div><label className="text-xs text-os-muted">Reporting month<input type="month" value={month} disabled={busy} onChange={e => void filter(e.target.value)} className={field} /></label>{month && <button disabled={busy} onClick={() => void filter('')} className="pressable text-sm underline">All dates</button>}</div>
    <p className="mt-3 text-xs leading-5 text-os-muted">Money movement, not revenue or account balance. Imports stay separate from live sources; transfers may appear on both sides. No currency conversion.</p>
    {!summaries.length && <p className="my-5 text-sm text-os-muted">No imported transactions{month ? ' for this month' : ' yet'}.</p>}
    <div className="mt-5 space-y-5">{summaries.map(row => <div key={`${row.source}:${row.account}:${row.currency}`} className="border-l-2 border-os-border pl-4">
      <h3 className="break-words text-sm font-semibold">{row.account} / {row.source === 'paypal' ? 'PayPal CSV' : 'Standard CSV'} / {row.currency}</h3>
      <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">{[['Inflow', row.incoming], ['Outflow', row.outgoing], ['Net movement', row.net]].map(([label, value]) => <div key={label}><dt className="text-xs text-os-muted">{label}</dt><dd className="mt-1 break-words text-xl tabular-nums">{money(Number(value), row.currency)}</dd></div>)}</dl>
      <p className="mt-3 text-xs text-os-muted">{row.count} transactions / {row.start} to {row.end}</p><p className="mt-1 text-xs text-os-muted">Last import: <time dateTime={row.importedAt}>{new Date(row.importedAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</time></p>
    </div>)}</div>
    {canImport && <details className="mt-6 border-t border-os-border pt-4"><summary className="cursor-pointer text-sm text-os-accent">Import CSV</summary>
      <fieldset disabled={busy} className="mt-5 min-w-0"><div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="text-xs">Format<select value={format} className={field} onChange={e => { setFormat(e.target.value as ImportFormat); setPreview(null); }}><option value="standard">Standard transactions</option><option value="paypal">PayPal activity (US dates)</option></select></label><label className="text-xs">Account label<input maxLength={80} value={account} onChange={e => { setAccount(e.target.value); setPreview(null); }} placeholder="Business checking" className={field} /></label></div>
      <p className="my-3 text-xs leading-5 text-os-muted">{format === 'standard' ? 'Columns: id, date (YYYY-MM-DD), description, amount, currency. Positive = inflow; negative = outflow.' : 'Columns: Transaction ID, Date (MM/DD/YYYY), Name, Net, Currency, Status. Only Completed rows are imported; Net includes PayPal fees.'} USD, CAD, EUR, GBP, AUD, NZD and MXN. Up to 2,000 rows / 512 KiB. Reuse the same account label for overlapping exports.</p>
      <a href="/templates/transactions.csv" download className="inline-flex items-center gap-2 text-xs text-os-accent underline"><Download size={14} />Standard CSV template</a>
      <label className="mt-4 block text-xs">CSV file<input ref={fileRef} type="file" accept=".csv,text/csv" className={field} onChange={async e => {
        const file = e.target.files?.[0], version = ++selection.current; setPreview(null); setCsv(''); setMessage('');
        if (!file) return;
        if (file.size > MAX_CSV_BYTES) { setMessage('CSV exceeds 512 KiB.'); return; }
        try { const text = await file.text(); if (version === selection.current) setCsv(text); } catch { setMessage('Unable to read file.'); }
      }} /></label>
      <button type="button" disabled={!csv || !account.trim() || busy} onClick={() => void request('preview')} className="pressable mt-4 inline-flex items-center gap-2 rounded border border-os-border px-4 py-3 text-sm disabled:opacity-50"><Upload size={16} />{busy ? 'Working...' : 'Preview import'}</button>
      {preview && <div className="mt-5"><p className="text-sm">{preview.count} transactions ready. {preview.excluded} non-completed rows excluded.</p><p className="mt-1 text-xs text-os-muted">First {preview.rows.length} rows; existing IDs will be skipped only when their values match.</p><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Import preview</caption><thead><tr><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2">Amount</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.id} className="border-t border-os-border"><td className="p-2 whitespace-nowrap">{row.date}</td><td className="max-w-64 break-words p-2">{row.description}</td><td className="whitespace-nowrap p-2">{money(row.amountCents, row.currency)}</td></tr>)}</tbody></table></div><button type="button" disabled={busy} onClick={() => void request('save')} className="pressable mt-4 inline-flex items-center gap-2 rounded bg-os-accent px-4 py-3 text-sm text-os-bg"><Check size={16} />Confirm import</button></div>}
      </fieldset>
    </details>}
    <p role="status" aria-live="polite" className="mt-4 text-sm text-os-muted">{message}</p>
  </section>;
}
