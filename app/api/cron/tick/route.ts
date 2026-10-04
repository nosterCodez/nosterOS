import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { FounderDb } from '@/lib/db';
import { apiWorkspace } from '@/lib/session';
import { workspaceJob } from '@/lib/workspace-jobs';
import { createRuntime } from '@/lib/agents/runtime';
import { realAgents } from '@/lib/agents/real';
import { COLLECTORS } from '@/lib/collectors';
import { dueCollectors, runCollector } from '@/lib/collectors/run';
import { dueCrons, lastScheduledOccurrence, type SchedulableCron } from '@/lib/cron-scheduler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // better-sqlite3 is native

/**
 * The cron runner loop. Until now `agent_crons` was storage plus UI and
 * nothing ever fired; this is the piece that makes a 9am job actually happen.
 *
 * GET is a dry run (what is due, and when each job last ran). POST executes
 * every due job through the normal agent runtime, so a scheduled run is
 * recorded in `agent_runs` exactly like a manual one, plus a `cron_runs` row
 * carrying the schedule's own history.
 *
 * instrumentation.ts POSTs this every minute. Catch-up is handled in
 * lib/cron-scheduler.ts, so a redeploy over the 9am window still delivers.
 */
function schedulable(db: FounderDb): SchedulableCron[] {
  const stats = db.cronRuns.statsByCron();
  return db.agentCrons.all().map((c) => ({
    id: c.id,
    agentId: c.agentId,
    schedule: c.schedule,
    description: c.description,
    enabled: c.enabled,
    lastRunAt: stats[c.id]?.lastRunAt ?? null,
  }));
}

export async function GET() {
  const authError = await apiSessionError('/api/cron/tick', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;
  const db = workspace.db;
  const crons = schedulable(db);
  const now = new Date();
  return NextResponse.json({
    now: now.toISOString(),
    crons: crons.map((c) => ({
      ...c,
      lastScheduled: lastScheduledOccurrence(c.schedule, now)?.toISOString() ?? null,
    })),
    due: dueCrons(crons, now).map((c) => c.id),
  });
}

export async function POST() {
  const authError = await apiSessionError('/api/cron/tick', 'POST');
  if (authError) return authError;

  return workspaceJob('/api/cron/tick', async ({ db, workspace }) => {
    const now = new Date();
    const due = dueCrons(schedulable(db), now);
    const collectors = dueCollectors(COLLECTORS, db, now);
    if (due.length === 0 && collectors.length === 0) return { ran: [], due: 0 };

    const runtimeApi = createRuntime(db, realAgents);
    const ran: { cronId: string; agentId: string; ok: boolean; summary: string }[] = [];

    for (const cron of due) {
      const startedAt = new Date().toISOString();
      let ok = false;
      let summary = '';
      try {
        const run = await runtimeApi.run(cron.agentId);
        ok = run.ok;
        summary = run.summary;
      } catch (err) {
        summary = err instanceof Error ? err.message : String(err);
      }
      // Record the firing even on failure: a cron that keeps erroring must be
      // visible in the stats rather than silently retried every minute.
      db.cronRuns.insert({
        id: randomUUID(),
        cronId: cron.id,
        agentId: cron.agentId,
        startedAt,
        finishedAt: new Date().toISOString(),
        ok,
        summary: summary.slice(0, 2000),
      });
      ran.push({ cronId: cron.id, agentId: cron.agentId, ok, summary });
      console.log(`[workspace:${workspace.id}] cron ${cron.id}: ${ok ? 'ok' : 'failed'}`);
    }

    for (const collector of collectors) {
      // Another overlapping tick may have started it while agent crons ran.
      if (!dueCollectors([collector], db, new Date()).length) continue;
      const result = await runCollector(collector, db, new Date());
      ran.push({ cronId: `collector:${collector.id}`, agentId: collector.id, ok: result.ok, summary: result.error ?? `${result.pointsWritten} points written` });
    }
    return { ran, due: due.length + collectors.length };
  });
}
