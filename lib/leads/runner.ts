import type { FounderDb } from '@/lib/db';
import { leadEngineEnabled } from './flags';
import type { LeadSource } from './sources/types';
type Workspace = { id: string };
type Dependencies = { workspaces: Workspace[]; withDb<T>(id: string, work: (db: FounderDb) => Promise<T>): Promise<T>;
  sources: LeadSource[]; env?: Record<string, string | undefined>; now?: () => number; maxItems?: number; budgetMs?: number; offset?: number };
const failures = new Set(['source_not_imported', 'city_not_unique', 'source_too_large', 'source_incomplete']);
export async function runLeadBatch(d: Dependencies) {
  const env = d.env ?? process.env, clock = d.now ?? Date.now;
  const workspaces = d.workspaces.filter(w => leadEngineEnabled(w.id, env));
  if (!workspaces.length) return { ran: 0, skipped: 'private_beta', nextOffset: 0 };
  const count = Math.min(25, Math.max(1, d.maxItems ?? 25)), budget = Math.min(20000, Math.max(1, d.budgetMs ?? 20000));
  const deadline = clock() + budget, signal = AbortSignal.timeout(budget);
  let ran = 0, idle = 0, index = (d.offset ?? Math.floor(clock() / 60000)) % workspaces.length;
  while (ran < count && clock() < deadline && !signal.aborted && idle < workspaces.length) {
    const workspace = workspaces[index]; index = (index + 1) % workspaces.length;
    let worked = false;
    try {
      await d.withDb(workspace.id, async db => {
        const plan = db.leadPlans.active(), profile = db.businessProfiles.current();
        if (!leadEngineEnabled(workspace.id, env) || !plan || !profile || plan.profileVersion !== profile.version) return;
        const now = new Date(clock()), remaining = plan.plan.weeklyLeadTarget - db.leadJobs.countSince(now);
        if (remaining <= 0) { db.leadJobs.stopAtTarget(plan.id, now); return; }
        db.leadJobs.enqueue(plan, 'scheduled', db.leadPlans.preferences().runSchedule ?? 'daily', now);
        const job = db.leadJobs.claim(plan.id, now); if (!job) return;
        worked = true; ran++;
        const source = d.sources.find(s => s.id === job.source);
        if (!source || source.costPerCallUsd !== 0) { db.leadJobs.fail(job, 'source_not_imported', now); return; }
        let abort: () => void = () => {};
        try {
          if (job.source === 'overpass' && !db.leadJobs.markRequested(job)) throw new Error('source_unavailable');
          const aborted = new Promise<never>((_, reject) => { abort = () => reject(new Error('tick_timeout')); if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); });
          const results = await Promise.race([source.find({ city: job.city, queries: job.queries, limit: Math.min(500, remaining), signal }), aborted]);
          signal.throwIfAborted();
          // Ignore results when authorization, current profile or active plan changed during the request.
          if (!leadEngineEnabled(workspace.id, env) || db.leadPlans.active()?.id !== plan.id || db.businessProfiles.current()?.version !== profile.version) {
            db.leadJobs.fail(job, 'source_unavailable', new Date(clock())); return;
          }
          db.leadJobs.complete(job, results, new Date(clock()), plan.plan.weeklyLeadTarget);
        } catch (error) {
          const code = error instanceof Error && failures.has(error.message) ? error.message as 'source_not_imported' | 'city_not_unique' | 'source_too_large' | 'source_incomplete' : signal.aborted ? 'tick_timeout' : 'source_unavailable';
          db.leadJobs.fail(job, code, new Date(clock()));
        } finally { signal.removeEventListener('abort', abort); }
      });
    } catch { /* An unavailable workspace must not stop other workspaces. */ }
    idle = worked ? 0 : idle + 1;
  }
  return { ran, nextOffset: index };
}
