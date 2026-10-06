'use client';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Copy, Save, RotateCcw, Upload, Check, AlertTriangle, Minus, Eye } from 'lucide-react';
import { z } from 'zod';
import { Markdown } from '@/components/Markdown';
import { BusinessProfile, ProfileVersion, PROFILE_SECTIONS } from '@/lib/business-profile/schema';
import { PROFILE_PROMPT } from '@/lib/business-profile/prompt';
import { parseBusinessProfile, ProfileInputError } from '@/lib/business-profile/parser';
const State = z.object({ current: BusinessProfile.nullable(), versions: z.array(ProfileVersion).max(20) });
const button = 'inline-flex items-center justify-center gap-2 rounded-ctl border border-os-border-strong px-3 py-2 text-xs text-os-text hover:bg-os-surface disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent';
const inputStyle = 'w-full min-w-0 rounded-ctl border border-os-border-strong bg-os-bg p-3 text-sm leading-relaxed text-os-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent';
type Props = { workspaceId: string; canEdit: boolean; current: BusinessProfile | null; versions: ProfileVersion[] };
export function BusinessProfileEditor(props: Props) {
  const [current, setCurrent] = useState(props.current);
  const [versions, setVersions] = useState(props.versions);
  const [draft, setDraft] = useState(props.current?.rawMarkdown ?? '');
  const [view, setView] = useState(props.current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [serverLines, setServerLines] = useState<number[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => {
    try { return { parsed: parseBusinessProfile(draft), error: '', lines: [] as number[] }; }
    catch (e) { return { parsed: null, error: e instanceof ProfileInputError ? e.message : 'Invalid profile.', lines: e instanceof ProfileInputError ? e.lines : [] }; }
  }, [draft]);
  const lines = [...new Set([...preview.lines, ...serverLines])];
  async function api(path: string, body?: object) {
    const response = await fetch(`/api/business-profile${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-omegaos-workspace': props.workspaceId }, body: body ? JSON.stringify(body) : undefined });
    const result: unknown = await response.json();
    if (!response.ok) {
      const issue = z.object({ error: z.string(), lines: z.array(z.number().int().positive()).optional() }).safeParse(result);
      if (issue.success) { setServerLines(issue.data.lines ?? []); throw new Error(issue.data.error); }
      throw new Error('Unable to load profile. Please reload and try again.');
    }
    return result;
  }
  async function save(id?: string) {
    setBusy(true); setError(''); setMessage(''); setServerLines([]);
    try {
      const state = State.parse(await api(id ? '/restore' : '', id ? { id } : { markdown: draft }));
      setCurrent(state.current); setView(state.current); setVersions(state.versions); setDraft(state.current?.rawMarkdown ?? '');
      setMessage(id ? `Restored as version ${state.current?.version}.` : `Saved version ${state.current?.version}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.'); }
    finally { setBusy(false); }
  }
  async function show(id: string) {
    setBusy(true); setError('');
    try { const result = z.object({ profile: BusinessProfile }).parse(await api(`?id=${encodeURIComponent(id)}`)); setView(result.profile); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load version.'); }
    finally { setBusy(false); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setError(''); setMessage(''); setBusy(true);
    try {
      if (!/\.md$/i.test(file.name) || file.size > 160000) throw new Error('Choose a UTF-8 .md file with at most 40,000 characters.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (text.length > 40000) throw new Error('The file exceeds 40,000 characters.');
      setDraft(text); setServerLines([]);
    } catch { setError('Choose a valid UTF-8 .md file with at most 40,000 characters.'); }
    finally { setBusy(false); }
  }
  function selectLine(line: number) {
    const preceding = draft.split('\n').slice(0, line - 1).join('\n');
    const start = preceding.length + (line > 1 ? 1 : 0);
    textarea.current?.focus(); textarea.current?.setSelectionRange(start, start + (draft.split('\n')[line - 1]?.length ?? 0));
  }
  return <div className="min-w-0 space-y-8">
    <div role="status" aria-live="polite" className="text-sm text-os-ok">{message}</div>
    {error && <p role="alert" className="text-sm text-os-err">{error}</p>}
    {props.canEdit ? <>
      <section className="min-w-0 border-b border-os-border pb-6" aria-labelledby="profile-prompt-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="profile-prompt-title" className="text-base font-semibold">01 / Copy the prompt</h2>
          <button type="button" className={`pressable ${button}`} onClick={async () => {
            try { await navigator.clipboard.writeText(PROFILE_PROMPT); setMessage('Prompt copied.'); setError(''); }
            catch { setError('Clipboard unavailable. Select the prompt text to copy it.'); }
          }}><Copy size={15} aria-hidden="true" />Copy prompt</button>
        </div>
        <details><summary className="cursor-pointer text-sm text-os-muted">Business profile prompt</summary>
          <textarea aria-label="Business profile prompt" readOnly value={PROFILE_PROMPT} rows={10} className={`${inputStyle} mt-3 resize-y`} />
        </details>
        <div className="mt-3 flex flex-wrap gap-5 text-xs underline underline-offset-4">
          <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">Open Claude</a>
          <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">Open ChatGPT</a>
        </div>
      </section>
      <section aria-labelledby="profile-draft-title" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="profile-draft-title" className="text-base font-semibold">02 / Paste what your AI wrote</h2>
          <button type="button" className={`pressable ${button}`} disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} aria-hidden="true" />Upload .md</button>
          <input ref={fileInput} type="file" accept=".md,text/markdown" aria-label="Upload Markdown profile" className="hidden" onChange={upload} disabled={busy} />
        </div>
        <label htmlFor="profile-draft" className="mb-2 block text-xs text-os-muted">Business profile Markdown</label>
        <textarea id="profile-draft" ref={textarea} value={draft} rows={12} maxLength={40000} disabled={busy}
          aria-invalid={!!preview.error} aria-describedby="profile-input-status"
          className={`${inputStyle} resize-y ${lines.length ? 'border-os-err' : ''}`}
          onChange={e => { setDraft(e.target.value); setServerLines([]); setMessage(''); setError(''); }} />
        <div id="profile-input-status" className="mt-2 text-xs text-os-muted">
          <span>{draft.length.toLocaleString()} / 40,000 characters</span>
          {preview.error && <p role="alert" className="mt-2 text-os-err">{preview.error}</p>}
        </div>
        {!!lines.length && <ul className="mt-3 space-y-1" aria-label="Lines requiring attention">{lines.map(line => <li key={line} className="border-l-2 border-os-err pl-3 text-xs text-os-err">
          <button type="button" className="pressable py-1 underline underline-offset-4" onClick={() => selectLine(line)}>Line {line}: possible secret, remove before saving</button>
        </li>)}</ul>}
      </section>
      <section aria-labelledby="profile-check-title" className="border-b border-os-border pb-6">
        <h2 id="profile-check-title" className="mb-4 text-base font-semibold">03 / Review and save</h2>
        <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">{PROFILE_SECTIONS.map(section => {
          const status = preview.parsed?.completeness[section.key] ?? 'missing';
          const Icon = status === 'found' ? Check : status === 'unknown' ? AlertTriangle : Minus;
          return <li key={section.key} className="min-w-0 border-b border-os-border pb-3">
            <div className="flex items-start gap-2 text-xs"><Icon size={15} aria-hidden="true" className={status === 'found' ? 'shrink-0 text-os-ok' : 'shrink-0 text-os-warn'} />
              <span className="min-w-0 flex-1">{section.label}</span><span className="shrink-0 text-os-muted">{status}</span></div>
            {status !== 'found' && <p className="mt-1 pl-6 text-xs text-os-muted">{section.hint}</p>}
          </li>;
        })}</ul>
        <button type="button" className={`pressable ${button} mt-5 border-os-accent`} disabled={busy || !draft.trim() || !preview.parsed || !!lines.length} onClick={() => save()}>
          <Save size={15} aria-hidden="true" />{busy ? 'Working...' : 'Save profile'}</button>
      </section>
    </> : <p className="text-sm text-os-muted">Read-only workspace access.</p>}
    <section aria-labelledby="profile-current-title" className="min-w-0">
      <h2 id="profile-current-title" className="mb-4 text-base font-semibold">{view ? `${view.id === current?.id ? 'Current profile' : 'Historical profile'} / Version ${view.version}` : 'Current profile'}</h2>
      {view ? <Markdown text={view.rawMarkdown} safe /> : <p className="text-sm text-os-muted">No business profile saved.</p>}
    </section>
    <section aria-labelledby="profile-history-title" className="border-t border-os-border pt-6">
      <h2 id="profile-history-title" className="mb-3 text-base font-semibold">Version history</h2>
      {!versions.length && <p className="text-sm text-os-muted">No versions yet.</p>}
      <ul className="divide-y divide-os-border">{versions.map(version => <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 text-xs"><span>Version {version.version}{version.isCurrent ? ' / Current' : ''}</span><time className="mt-1 block text-os-muted" dateTime={version.createdAt}>{version.createdAt.replace('T', ' ').slice(0, 16)} UTC</time></div>
        <div className="flex flex-wrap gap-2"><button type="button" className={`pressable ${button}`} disabled={busy} onClick={() => show(version.id)}><Eye size={14} aria-hidden="true" />View<span className="sr-only"> version {version.version}</span></button>
          {props.canEdit && !version.isCurrent && <button type="button" className={`pressable ${button}`} disabled={busy} onClick={() => save(version.id)}><RotateCcw size={14} aria-hidden="true" />Restore<span className="sr-only"> version {version.version}</span></button>}
        </div>
      </li>)}</ul>
    </section>
  </div>;
}
