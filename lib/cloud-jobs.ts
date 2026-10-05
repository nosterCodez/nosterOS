import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { CLOUD_SOURCES, cloudSource } from '@/lib/cloud-catalog';
import { collectCloud } from '@/lib/cloud-adapters';
import { credentialVersion } from '@/lib/cloud-sources';
import { CloudError, CLOUD_ERROR_TEXT } from '@/lib/cloud-http';
import { CloudSnapshotSchema } from '@/lib/cloud-records';
import type { VaultContext } from '@/lib/creds';
import { getMetric } from '@/lib/metrics/registry';
import { listWorkspaces } from '@/lib/workspace-jobs';
import { withWorkspaceDb } from '@/lib/workspace-storage';
import { PRINTIFY_RECONNECT } from '@/lib/printify-credentials';

export async function syncSource(ctx: VaultContext, id: string, options: { manual?: boolean; signal?: AbortSignal; collect?: typeof collectCloud; now?: Date; budgetMs?: number } = {}) {
  const source = cloudSource(id), record = ctx.db.cloudSources.get(id), now = options.now ?? new Date();
  const claim = randomUUID();
  if (source.planned || !record || (!record.enabled && !options.manual)) return { ok: false, skipped: 'paused' };
  let generation = '';
  try { generation = credentialVersion(ctx, id); } catch { return { ok: false, skipped: 'vault unavailable' }; }
  if (!generation || generation !== record.credentialVersion) return { ok: false, skipped: 'configure connection' };
  if (id === 'printify' && record.error === PRINTIFY_RECONNECT) return { ok: false, skipped: PRINTIFY_RECONNECT };
  if (!ctx.db.cloudSources.claim(id, record.revision, claim, +now, options.manual)) return { ok: false, skipped: options.manual && record.error ? 'Already syncing or retried recently. Wait one minute before retrying.' : 'Already syncing or synced recently. Try again after 15 minutes.' };
  const runId = ctx.db.collectorRuns.start(`cloud.${id}`, now);
  const budget = AbortSignal.timeout(options.budgetMs ?? 11000);
  const signal = options.signal ? AbortSignal.any([budget, options.signal]) : budget;
  let pointsWritten = 0, error: string | null = null;
  let stage = 'collect';
  let onAbort: () => void = () => {};
  try {
    const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(new CloudError('timeout')); if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); });
    const result = await Promise.race([(options.collect ?? collectCloud)(ctx, id, record.resource, { now, signal }), aborted]);
    stage = 'snapshot';
    signal.throwIfAborted();
    const snapshot = CloudSnapshotSchema.parse(result);
    if (credentialVersion(ctx, id) !== generation) throw new CloudError('changed');
    const points = Object.entries(snapshot.values).flatMap(([key, value]) => {
      const metricId = `cloud.${id}.${key}`, metric = getMetric(metricId);
      if (!metric || !source.metrics.some(m => m.id === key)) throw new CloudError('invalid_data');
      return value === null ? [] : [{ metricId, businessId: 'workspace' as const, capturedAt: snapshot.at, value }];
    });
    stage = 'persist';
    if (!ctx.db.cloudSources.finish(id, record.revision, claim, snapshot, null, () => ctx.db.metricPoints.upsert(points))) throw new CloudError('changed');
    pointsWritten = points.length;
  } catch (e) {
    // Log only bounded schema paths/codes, never provider values, messages, tokens or account IDs.
    console.warn('[cloud-sync]', { source: source.id, stage, code: e instanceof CloudError ? e.code : e instanceof ZodError ? 'schema' : 'internal', ...(e instanceof ZodError ? { issues: e.issues.slice(0, 5).map(issue => ({ code: issue.code, path: issue.path.map(part => typeof part === 'number' ? 'item' : String(part).replace(/[^a-zA-Z]/g, '').slice(0, 30)).join('.').slice(0, 120) })) } : {}) });
    error = CLOUD_ERROR_TEXT[e instanceof CloudError ? e.code : signal.aborted ? 'timeout' : 'invalid_data'];
    const rejectedPersonalToken = id === 'printify' && generation.startsWith('personal:') && e instanceof CloudError && e.code === 'authentication';
    if (rejectedPersonalToken) error = PRINTIFY_RECONNECT;
    // A delayed failure cannot disable a replacement token or a new OAuth grant.
    let unchanged = false;
    try { unchanged = credentialVersion(ctx, id) === generation; } catch { /* Vault unavailable. */ }
    if (!rejectedPersonalToken || unchanged) ctx.db.cloudSources.finish(id, record.revision, claim, null, error, undefined, rejectedPersonalToken);
  } finally { signal.removeEventListener('abort', onAbort); }
  ctx.db.collectorRuns.finish(runId, { ok: !error, pointsWritten, error });
  return { ok: !error, pointsWritten, error };
}
let tickRunning = false;
export async function runCloudTick() {
  if (tickRunning) return { skipped: 'already running', ran: 0 };
  tickRunning = true;
  try {
    const workspaces = await listWorkspaces();
    if (!workspaces.length) return { ran: 0 };
    // Rotate starting workspace each minute so a slow account cannot starve later ones.
    const offset = Math.floor(Date.now() / 60000) % workspaces.length;
    const ordered = [...workspaces.slice(offset), ...workspaces.slice(0, offset)];
    const signal = AbortSignal.timeout(16000);
    let ran = 0;
    for (const workspace of ordered) {
      if (signal.aborted) break;
      try {
        await withWorkspaceDb(workspace.id, async db => {
          const candidates = CLOUD_SOURCES.filter(s => !s.planned).map(s => db.cloudSources.get(s.id)).filter(r => r?.enabled && (r.lastAttempt === null || Date.now() - r.lastAttempt >= 15 * 60_000)).sort((a, b) => (a!.lastAttempt ?? 0) - (b!.lastAttempt ?? 0));
          const ctx = { workspace, db };
          // Skip missing/stale credentials without preventing another due source from running.
          for (const record of candidates) {
            if (signal.aborted) break;
            const result = await syncSource(ctx, record!.id, { signal });
            if (!('skipped' in result)) { ran++; break; }
          }
        });
      } catch { /* One unavailable workspace must not stop the others. */ }
    }
    return { ran };
  } finally { tickRunning = false; }
}
