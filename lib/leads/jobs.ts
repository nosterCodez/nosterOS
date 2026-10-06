import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Place } from './sources/types';
import { PlanRecord } from './schema';
const Job = z.object({ id: z.string().uuid(), runId: z.string().uuid(), source: z.enum(['overpass', 'foursquare']),
  city: z.string(), queries: z.array(z.string()), state: z.enum(['queued', 'running', 'done', 'failed', 'skipped']),
  attempts: z.number().int(), nextAttemptAt: z.number(), lease: z.string().nullable(), leaseUntil: z.number().nullable(),
  requested: z.boolean(), errorCode: z.string().nullable(), results: z.array(Place).max(500) });
export type LeadJob = z.infer<typeof Job>;
const SELECT = `SELECT id,run_id AS runId,source,city,queries_json,state,attempts,next_attempt_at AS nextAttemptAt,
 lease_id AS lease,lease_until AS leaseUntil,request_started AS requested,error_code AS errorCode,result_json FROM lead_jobs`;
function read(raw: unknown): LeadJob {
  const row = z.object({ queries_json: z.string(), result_json: z.string(), requested: z.number() }).passthrough().parse(raw);
  return Job.parse({ ...row, queries: JSON.parse(row.queries_json), results: JSON.parse(row.result_json), requested: Boolean(row.requested) });
}
export function weekStart(now: Date) { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString(); }
export function createLeadJobs(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS lead_runs (
    id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,schedule_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,
    state TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,error_code TEXT);
    CREATE TABLE IF NOT EXISTS lead_jobs (
    id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES lead_runs(id),stage TEXT NOT NULL,item_key TEXT NOT NULL,
    source TEXT NOT NULL,city TEXT NOT NULL,queries_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,error_code TEXT,
    lease_id TEXT,lease_until INTEGER,request_started INTEGER NOT NULL DEFAULT 0,result_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE(run_id,stage,item_key));
    CREATE INDEX IF NOT EXISTS lead_jobs_due ON lead_jobs(state,next_attempt_at);`);
  const get = (id: string) => { const row = db.prepare(`${SELECT} WHERE id=?`).get(id); return row ? read(row) : null; };
  function countSince(now: Date) {
    const rows = db.prepare(`SELECT j.result_json FROM lead_jobs j JOIN lead_runs r ON r.id=j.run_id WHERE r.created_at>=? AND j.state='done'`).all(weekStart(now)) as { result_json: string }[];
    const ids = new Set<string>(); for (const row of rows) for (const p of z.array(Place).parse(JSON.parse(row.result_json))) ids.add(`${p.source}:${p.id}`);
    return ids.size;
  }
  function settleRun(runId: string, now: Date) {
    const pending = db.prepare("SELECT 1 FROM lead_jobs WHERE run_id=? AND state IN ('queued','running') LIMIT 1").get(runId);
    if (!pending) db.prepare(`UPDATE lead_runs SET state=CASE WHEN EXISTS(SELECT 1 FROM lead_jobs WHERE run_id=? AND state='failed') THEN 'failed' ELSE 'done' END,finished_at=? WHERE id=?`).run(runId, now.toISOString(), runId);
  }
  return {
    get, countSince,
    recent() { return z.array(z.object({ id: z.string(), planId: z.string(), state: z.string(), createdAt: z.string(), errorCode: z.string().nullable(), jobs: z.number(), found: z.number() })).parse(db.prepare(`SELECT r.id,r.plan_id AS planId,r.state,r.created_at AS createdAt,r.error_code AS errorCode,
      (SELECT count(*) FROM lead_jobs j WHERE j.run_id=r.id) AS jobs,
      (SELECT coalesce(sum(json_array_length(j.result_json)),0) FROM lead_jobs j WHERE j.run_id=r.id) AS found
      FROM lead_runs r ORDER BY r.created_at DESC LIMIT 10`).all()); },
    jobs(runId: string) { return db.prepare(`${SELECT} WHERE run_id=? ORDER BY source,city`).all(runId).map(read); },
    enqueue(plan: PlanRecord, kind: 'manual' | 'scheduled', schedule: 'daily' | 'weekly', now = new Date()) {
      PlanRecord.parse(plan); if (plan.status !== 'active') throw new Error('active_plan_required');
      return db.transaction(() => {
        if (countSince(now) >= plan.plan.weeklyLeadTarget) return { ok: false as const, reason: 'weekly_target_reached' };
        if (kind === 'manual') {
          const count = db.prepare("SELECT count(*) AS n FROM lead_runs WHERE kind='manual' AND substr(created_at,1,10)=?").get(now.toISOString().slice(0, 10)) as { n: number };
          if (count.n >= 3) return { ok: false as const, reason: 'manual_daily_limit' };
        }
        const slot = schedule === 'weekly' ? weekStart(now).slice(0, 10) : now.toISOString().slice(0, 10);
        const key = kind === 'manual' ? `manual:${randomUUID()}` : `${schedule}:${slot}`;
        const existing = db.prepare('SELECT id FROM lead_runs WHERE schedule_key=?').get(key) as { id: string } | undefined;
        if (existing) return { ok: true as const, id: existing.id, created: false };
        const id = randomUUID();
        db.prepare("INSERT INTO lead_runs(id,plan_id,schedule_key,kind,state,created_at) VALUES (?,?,?,?,'queued',?)").run(id, plan.id, key, kind, now.toISOString());
        const cities = new Map<string, { city: string; queries: Set<string> }>();
        for (const target of plan.plan.targets) for (const city of target.cities) {
          const k = city.trim().toLowerCase(); const row = cities.get(k) ?? { city: city.trim(), queries: new Set<string>() };
          target.searchQueries.forEach(q => row.queries.add(q)); cities.set(k, row);
        }
        if (!cities.size) throw new Error('cities_required');
        for (const [key, value] of cities) for (const source of ['overpass', 'foursquare']) db.prepare(`INSERT INTO lead_jobs(id,run_id,stage,item_key,source,city,queries_json) VALUES (?,?,'find',?,?,?,?)`)
          .run(randomUUID(), id, `${source}:${key}`, source, value.city, JSON.stringify([...value.queries]));
        return { ok: true as const, id, created: true };
      }).immediate();
    },
    claim(planId: string, now = new Date()) {
      return db.transaction(() => {
        // Expired owners cannot later complete; a dispatched Overpass request never repeats in this run.
        db.prepare(`UPDATE lead_jobs SET state=CASE WHEN attempts>=3 OR (source='overpass' AND request_started=1) THEN 'failed' ELSE 'queued' END,
          lease_id=NULL,lease_until=NULL,error_code='interrupted' WHERE state='running' AND lease_until<=?`).run(+now);
        db.prepare(`UPDATE lead_jobs SET state='skipped',error_code='plan_changed',lease_id=NULL,lease_until=NULL
          WHERE state IN ('queued','running') AND run_id IN (SELECT id FROM lead_runs WHERE plan_id<>?)`).run(planId);
        for (const row of db.prepare("SELECT id FROM lead_runs WHERE state='queued'").all() as { id: string }[]) settleRun(row.id, now);
        const row = db.prepare(`${SELECT} WHERE state='queued' AND next_attempt_at<=? AND run_id IN (SELECT id FROM lead_runs WHERE plan_id=?) ORDER BY next_attempt_at,rowid LIMIT 1`).get(+now, planId);
        if (!row) return null;
        const job = read(row), lease = randomUUID();
        db.prepare("UPDATE lead_jobs SET state='running',attempts=attempts+1,lease_id=?,lease_until=? WHERE id=?").run(lease, +now + 60000, job.id);
        return get(job.id)!;
      }).immediate();
    },
    markRequested(job: LeadJob) { return db.prepare("UPDATE lead_jobs SET request_started=1 WHERE id=? AND lease_id=? AND state='running' AND request_started=0").run(job.id, job.lease).changes === 1; },
    complete(job: LeadJob, results: Place[], now = new Date(), weeklyTarget = 500) {
      const rows = z.array(Place).max(500).parse(results);
      return db.transaction(() => {
        const remaining = Math.max(0, weeklyTarget - countSince(now));
        const changed = db.prepare("UPDATE lead_jobs SET state='done',result_json=?,error_code=NULL,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=? AND state='running'").run(JSON.stringify(rows.slice(0, remaining)), job.id, job.lease).changes;
        settleRun(job.runId, now); return changed === 1;
      }).immediate();
    },
    fail(job: LeadJob, code: 'source_unavailable' | 'source_not_imported' | 'city_not_unique' | 'source_too_large' | 'source_incomplete' | 'tick_timeout', now = new Date()) {
      return db.transaction(() => {
        const current = get(job.id); if (!current || current.lease !== job.lease || current.state !== 'running') return;
        const state = code === 'source_not_imported' ? 'skipped' : job.attempts >= 3 || (job.source === 'overpass' && current.requested) ? 'failed' : 'queued';
        db.prepare('UPDATE lead_jobs SET state=?,error_code=?,next_attempt_at=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?')
          .run(state, code, +now + [60000, 600000, 3600000][Math.min(job.attempts - 1, 2)], job.id, job.lease);
        settleRun(job.runId, now);
      }).immediate();
    },
    stopAtTarget(planId: string, now = new Date()) {
      db.transaction(() => {
        db.prepare("UPDATE lead_jobs SET state='skipped',error_code='weekly_target_reached' WHERE state='queued' AND run_id IN (SELECT id FROM lead_runs WHERE plan_id=?)").run(planId);
        for (const row of db.prepare('SELECT id FROM lead_runs WHERE plan_id=?').all(planId) as { id: string }[]) settleRun(row.id, now);
      }).immediate();
    },
  };
}
