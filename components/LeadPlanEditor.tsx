'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Save, Check, RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { LeadPlan, PlanRecord, GeneratedBy } from '@/lib/leads/schema';
import { PlanQuestion } from '@/lib/leads/questions';
import type { LeadPlanState } from '@/lib/leads/state';
import { SIGNALS } from '@/lib/leads/signals';
const State = z.object({ latest: PlanRecord.nullable(), active: PlanRecord.nullable(), profileVersion: z.number().nullable(), profileChanged: z.boolean(),
  questions: z.array(PlanQuestion).max(6), generation: z.object({ costUsd: z.number().nullable(), attemptedProvider: GeneratedBy }).optional() });
const input = 'mt-1 w-full min-w-0 rounded-ctl border border-os-border-strong bg-os-bg p-2 text-sm text-os-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent';
const button = 'inline-flex items-center justify-center gap-2 rounded-ctl border border-os-border-strong px-3 py-2 text-sm hover:bg-os-surface disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent';
const provider = { rules: 'Rules-only', byo_openai: 'Your OpenAI key', byo_anthropic: 'Your Anthropic key', platform: 'Platform AI' };
const split = (s: string) => s.split(/[,\n]/).map(v => v.trim()).filter(Boolean);
type Props = { workspaceId: string; canEdit: boolean; canActivate: boolean; initial: LeadPlanState };
export function LeadPlanEditor({ workspaceId, canEdit, canActivate, initial }: Props) {
  const [state, setState] = useState(initial), [draft, setDraft] = useState(initial.latest?.plan ?? null);
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [generation, setGeneration] = useState<z.infer<typeof State>['generation']>();
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(state.latest?.plan);
  const stale = !!state.latest && state.latest.profileVersion !== state.profileVersion;
  async function send(body: object, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/leads/plan', { method: 'POST', headers: { 'content-type': 'application/json', 'x-omegaos-workspace': workspaceId }, body: JSON.stringify(body) });
      const value: unknown = await response.json();
      if (!response.ok) { const issue = z.object({ error: z.string() }).safeParse(value); throw new Error(issue.success ? issue.data.error : 'Unable to save. Reload and try again.'); }
      const next = State.parse(value); setState(next); setDraft(next.latest?.plan ?? null); setAnswers({});
      if (next.generation) setGeneration(next.generation); setMessage(success);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.'); }
    finally { setBusy(false); }
  }
  function change<K extends keyof LeadPlan>(key: K, value: LeadPlan[K]) { if (draft) setDraft({ ...draft, [key]: value }); }
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-os-border pb-4">
      <div className="text-sm text-os-muted">{state.active ? `Active plan v${state.active.version}` : 'No active plan'}{state.latest && ` / Latest v${state.latest.version} (${state.latest.status})`}</div>
      {canEdit && <button className={`pressable ${button}`} disabled={busy || !state.profileVersion || dirty} onClick={() => send({ action: 'generate' }, 'Draft generated. Review the questions and plan.')}><RefreshCw size={15} aria-hidden="true" />{busy ? 'Working...' : 'Generate plan'}</button>}
    </div>
    {!state.profileVersion && <p className="text-sm">Start with your <Link href="/settings/business-profile" className="underline underline-offset-4">Business profile</Link>.</p>}
    {(state.profileChanged || stale) && <p role="status" className="border-l-2 border-os-warn pl-3 text-sm text-os-warn">Profile changed. Generate and review a new plan before activation.</p>}
    <p role="status" aria-live="polite" className="text-sm text-os-ok">{message}</p>
    {error && <p role="alert" className="break-words text-sm text-os-err">{error}</p>}
    {state.latest && <p className="text-xs text-os-muted">{provider[state.latest.generatedBy]} / Profile v{state.latest.profileVersion}{generation && ` / Last generation estimate: ${generation.costUsd === null ? 'unavailable' : `$${generation.costUsd.toFixed(4)}`}`}</p>}
    {state.latest && state.questions.length > 0 && canEdit && !stale && <section className="rounded-ctl border border-os-border p-4" aria-labelledby="plan-questions">
      <h2 id="plan-questions" className="mb-4 text-base font-semibold">Fill the gaps</h2>
      <fieldset disabled={busy || dirty} className="grid min-w-0 gap-4 md:grid-cols-2">
        {state.questions.map(q => <label key={q.key} className="min-w-0 text-sm">{q.label}
          {q.type === 'yes_no' ? <input type="checkbox" className="ml-3 accent-os-accent" checked={Boolean(answers[q.key] ?? q.defaultValue)} onChange={e => setAnswers({ ...answers, [q.key]: e.target.checked })} />
            : q.type === 'single_choice' ? <select className={input} value={String(answers[q.key] ?? q.defaultValue)} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })}>{q.choices?.map(c => <option key={c} value={c}>${c}</option>)}</select>
              : <input className={input} type={q.type === 'number' ? 'number' : 'text'} min={q.min} max={q.max} maxLength={200} value={String(answers[q.key] ?? q.defaultValue)} onChange={e => setAnswers({ ...answers, [q.key]: q.type === 'number' ? Number(e.target.value) : e.target.value })} />}
        </label>)}
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className={`pressable ${button}`} disabled={busy || dirty} onClick={() => send({ action: 'answer', id: state.latest!.id, skip: false, answers }, 'Answers saved.')}><Check size={15} aria-hidden="true" />Save answers</button>
        <button className={`pressable ${button}`} disabled={busy || dirty} onClick={() => send({ action: 'answer', id: state.latest!.id, skip: true, answers: {} }, 'Defaults saved.')} >Skip</button>
      </div>
    </section>}
    {draft && <>
      <fieldset disabled={!canEdit || busy || stale} className="min-w-0 space-y-6">
        <section aria-labelledby="plan-targets" className="min-w-0 border-b border-os-border pb-6">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 id="plan-targets" className="text-base font-semibold">Targets</h2>
            {canEdit && <button className={`pressable ${button}`} title="Add target" aria-label="Add target" disabled={draft.targets.length >= 5} onClick={() => change('targets', [...draft.targets, { label: '', searchQueries: [''], cities: [], radiusMiles: 25 }])}><Plus size={16} /></button>}</div>
          {draft.targets.map((target, i) => <div key={i} className="grid min-w-0 gap-3 border-t border-os-border py-4 md:grid-cols-2">
            <label className="min-w-0 text-xs text-os-muted">Business type<input className={input} maxLength={100} value={target.label} onChange={e => change('targets', draft.targets.map((t, n) => n === i ? { ...t, label: e.target.value } : t))} /></label>
            <label className="min-w-0 text-xs text-os-muted">Search queries (up to 4, one per line)<textarea className={input} rows={2} value={target.searchQueries.join('\n')} onChange={e => change('targets', draft.targets.map((t, n) => n === i ? { ...t, searchQueries: e.target.value.split('\n') } : t))} /></label>
            <label className="min-w-0 text-xs text-os-muted">Cities (up to 10, one per line)<textarea className={input} rows={2} value={target.cities.join('\n')} onChange={e => change('targets', draft.targets.map((t, n) => n === i ? { ...t, cities: e.target.value.split('\n') } : t))} /></label>
            <div className="flex min-w-0 items-end gap-3"><label className="min-w-0 flex-1 text-xs text-os-muted">Radius (miles)<input className={input} type="number" min={1} max={100} value={target.radiusMiles} onChange={e => change('targets', draft.targets.map((t, n) => n === i ? { ...t, radiusMiles: Number(e.target.value) } : t))} /></label>
              {canEdit && <button className={`pressable ${button}`} title="Remove target" aria-label={`Remove target ${i + 1}`} disabled={draft.targets.length === 1} onClick={() => change('targets', draft.targets.filter((_, n) => n !== i))}><Trash2 size={16} /></button>}</div>
          </div>)}
        </section>
        <section aria-labelledby="plan-limits" className="border-b border-os-border pb-6">
          <h2 id="plan-limits" className="mb-3 text-base font-semibold">Limits and exclusions</h2>
          <div className="grid min-w-0 gap-4 md:grid-cols-3">{([
            ['weeklyLeadTarget', 'Weekly lead target', 5, 500], ['hotThreshold', 'Hot score threshold', 0, 100], ['maxPaidLookupsPerWeek', 'Maximum paid lookups per week', 0, 200],
          ] as const).map(([key, label, min, max]) => <label key={key} className="min-w-0 text-xs text-os-muted">{label}<input className={input} type="number" min={min} max={max} value={draft[key]} onChange={e => change(key, Number(e.target.value))} /></label>)}</div>
          <p className="mt-2 text-xs text-os-muted">Paid lookups remain subject to separately approved spending caps.</p>
          <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
            <label className="min-w-0 text-xs text-os-muted">Excluded keywords<textarea className={input} rows={2} value={draft.exclusions.keywords.join('\n')} onChange={e => change('exclusions', { ...draft.exclusions, keywords: e.target.value.split('\n') })} /></label>
            <label className="min-w-0 text-xs text-os-muted">Excluded domains<textarea className={input} rows={2} value={draft.exclusions.excludeDomains.join('\n')} onChange={e => change('exclusions', { ...draft.exclusions, excludeDomains: e.target.value.split('\n') })} /></label>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-os-accent" checked={draft.exclusions.excludeFranchises} onChange={e => change('exclusions', { ...draft.exclusions, excludeFranchises: e.target.checked })} />Exclude franchises</label>
        </section>
        <section aria-labelledby="plan-signals" className="border-b border-os-border pb-6"><h2 id="plan-signals" className="mb-3 text-base font-semibold">Scoring signals</h2>
          <div className="grid min-w-0 gap-3 md:grid-cols-2">{SIGNALS.map(signal => <label key={signal.key} className="flex min-w-0 items-center justify-between gap-3 text-sm"><span className="break-words">{signal.key.replaceAll('_', ' ')}</span>
            <select aria-label={`${signal.key} weight`} className={`${input} !w-24 shrink-0`} value={draft.signals.find(s => s.key === signal.key)?.weight ?? 0} onChange={e => change('signals', [...draft.signals.filter(s => s.key !== signal.key), ...(Number(e.target.value) ? [{ key: signal.key, weight: Number(e.target.value) }] : [])])}>{[-3, -2, -1, 0, 1, 2, 3].map(v => <option key={v} value={v}>{v === 0 ? 'Off' : v}</option>)}</select></label>)}</div>
        </section>
        <section aria-labelledby="plan-outreach" className="min-w-0 space-y-4 border-b border-os-border pb-6">
          <div className="flex items-center justify-between gap-3"><h2 id="plan-outreach" className="text-base font-semibold">Outreach direction</h2>{canEdit && <button className={`pressable ${button}`} title="Add angle" aria-label="Add angle" disabled={draft.angles.length >= 3} onClick={() => change('angles', [...draft.angles, { name: '', oneLiner: '', bestFor: '' }])}><Plus size={16} /></button>}</div>
          {draft.angles.map((angle, i) => <div key={i} className="grid min-w-0 gap-3 border-t border-os-border pt-3 md:grid-cols-2">
            {(['name', 'oneLiner', 'bestFor'] as const).map(key => <label key={key} className="min-w-0 text-xs text-os-muted">{key === 'oneLiner' ? 'One-line angle' : key === 'bestFor' ? 'Best for' : 'Angle name'}<input className={input} maxLength={key === 'name' ? 100 : 200} value={angle[key]} onChange={e => change('angles', draft.angles.map((a, n) => n === i ? { ...a, [key]: e.target.value } : a))} /></label>)}
            {canEdit && <button className={`pressable ${button} self-end justify-self-start`} title="Remove angle" aria-label={`Remove angle ${i + 1}`} onClick={() => change('angles', draft.angles.filter((_, n) => n !== i))}><Trash2 size={16} /></button>}
          </div>)}
          <label htmlFor="lead-plan-tone" className="block text-xs text-os-muted">Tone<textarea id="lead-plan-tone" aria-label="Tone" className={input} rows={2} maxLength={300} value={draft.tone} onChange={e => change('tone', e.target.value)} /></label>
          <div className="grid min-w-0 gap-3 md:grid-cols-3">{(['businessName', 'website', 'mailingAddress'] as const).map(key => <label key={key} className="min-w-0 text-xs text-os-muted">{key === 'businessName' ? 'Sender business name' : key === 'mailingAddress' ? 'Mailing address' : 'Website'}<input className={input} maxLength={key === 'businessName' ? 200 : 500} value={draft.senderIdentity[key]} onChange={e => change('senderIdentity', { ...draft.senderIdentity, [key]: e.target.value })} /></label>)}</div>
        </section>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && <button className={`pressable ${button}`} disabled={busy || stale || !dirty} onClick={() => {
          const normalized = { ...draft, targets: draft.targets.map(t => ({ ...t, cities: split(t.cities.join('\n')), searchQueries: split(t.searchQueries.join('\n')) })), exclusions: { ...draft.exclusions, keywords: split(draft.exclusions.keywords.join('\n')), excludeDomains: split(draft.exclusions.excludeDomains.join('\n')) } };
          const parsed = LeadPlan.safeParse(normalized); if (!parsed.success) { setError(`Check ${parsed.error.issues[0].path.join(' / ')}: ${parsed.error.issues[0].message}`); return; }
          void send({ action: 'edit', id: state.latest!.id, plan: parsed.data }, 'Draft saved. Review before activating.');
        }}><Save size={15} aria-hidden="true" />Save draft</button>}
        {canActivate && <button className={`pressable ${button}`} disabled={busy || dirty || stale || state.latest?.status !== 'draft'} onClick={() => send({ action: 'activate', id: state.latest!.id }, 'Plan activated. No outreach has been sent.')}><Check size={15} aria-hidden="true" />Activate plan</button>}
        {dirty && <span className="text-xs text-os-warn">Unsaved changes</span>}
        {!canActivate && <span className="text-xs text-os-muted">Only workspace owners and admins can activate plans.</span>}
      </div>
    </>}
  </div>;
}
