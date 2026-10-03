# 003: Metric store, registry and collector framework

Status: done - awaiting Claude review
Review by Claude: yes (new tables and the core interface everything builds on)

## Goal
Build the foundation every dashboard number goes through: the businesses
list, a registry of metrics, a time-series table, a standard collector
interface, and the runner that executes collectors on a schedule. No real
API connectors yet; one fake collector used only in tests proves it works.

Read `docs/architecture/dashboard.md` first.

## Do

### 1. Businesses — `lib/businesses.ts`
```ts
export const BUSINESSES = [
  { id: 'nostermarketing', name: 'nosterMarketing' },
  { id: 'nosterhealth', name: 'nosterHealth' },
  { id: 'nosterlogistics', name: 'nosterLogistics' },
  { id: 'autopilot-store', name: 'autopilot-store' },
] as const;
export type BusinessId = (typeof BUSINESSES)[number]['id'];
export const ROLLUP_ID = 'nostercodes'; // computed, never stored
```

### 2. Metric registry — `lib/metrics/registry.ts`
```ts
export type MetricDef = {
  id: string;              // dot-namespaced, e.g. 'gsc.clicks', 'stripe.revenue'
  label: string;           // what Noe sees: 'Search clicks'
  unit: 'count' | 'usd' | 'percent' | 'position' | 'seconds';
  source: string;          // collector id that writes it
  businesses: BusinessId[];
  rollup: 'sum' | 'avg' | 'none'; // how nostercodes combines businesses
  goodDirection: 'up' | 'down' | 'neutral';
};
export const METRICS: MetricDef[] = [];   // collectors' specs add entries
export function getMetric(id: string): MetricDef | undefined;
```
Registry ids must be unique; add a test that enforces it.

### 3. Tables and repos — `lib/db.ts` + `lib/schemas.ts`
Follow the existing pattern (`metricSnapshots` repo + `MetricSnapshotSchema`).
Add to the schema string:
```sql
CREATE TABLE IF NOT EXISTS metric_points (
  metric_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,      -- ISO 8601 UTC
  value REAL NOT NULL,
  PRIMARY KEY (metric_id, business_id, captured_at)
);
CREATE INDEX IF NOT EXISTS idx_metric_points_lookup
  ON metric_points (metric_id, business_id, captured_at DESC);
CREATE TABLE IF NOT EXISTS collector_runs (
  id TEXT PRIMARY KEY,
  collector_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL,
  points_written INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_collector_runs_lookup
  ON collector_runs (collector_id, started_at DESC);
```
Repos:
- `metricPoints.upsert(points)` in one transaction, `INSERT OR REPLACE`.
- `metricPoints.latest(metricId, businessId)` → `{value, capturedAt} | null`.
- `metricPoints.series(metricId, businessId, fromIso, toIso, bucket: 'day' | 'week')`
  → last value per bucket, ascending.
- `collectorRuns.start(collectorId)`, `.finish(id, {ok, pointsWritten, error})`,
  `.last(collectorId)`, `.lastOk(collectorId)`.
Zod schemas for a point and a run, validated on the way out like the rest
of the repo.

### 4. Collector interface — `lib/collectors/types.ts`
```ts
export type Point = { metricId: string; businessId: BusinessId; capturedAt: string; value: number };
export type CollectResult = { points: Point[]; note?: string };
export interface Collector {
  id: string;                 // matches MetricDef.source
  name: string;
  schedule: string;           // cron expression, validated with lib/cron.ts
  status(): Promise<ConnectorStatus>;   // existing type; honest, never faked
  collect(ctx: { now: Date; lastOkAt: string | null }): Promise<CollectResult>;
}
```

### 5. Runner — `lib/collectors/run.ts`
`runCollector(collector, db, now)`:
- skip with `ok: false, error: 'not configured'` when `status().state` isn't
  `connected` (still writes a run row, so the dashboard can say why);
- otherwise call `collect`, validate every point (registered metric, the
  metric's `source` equals this collector, business allowed for that
  metric, finite value, valid ISO time); reject the whole batch if any
  point is invalid and record which;
- upsert valid points, finish the run row; a thrown error finishes the run
  with `ok: false` and the message. Never deletes points.

`dueCollectors(collectors, db, now)` reuses `dueCrons` /
`lastScheduledOccurrence` from `lib/cron-scheduler.ts`, using each
collector's last run as `lastRunAt`.

### 6. Registry and wiring
- `lib/collectors/index.ts` exports `COLLECTORS: Collector[]` (empty for now).
- The existing `POST /api/cron/tick` also runs due collectors and includes
  them in its `ran` list as `collector:<id>`.
- `GET /api/metrics/points?metric=&business=&from=&to=&bucket=` returns a
  series; `business=nostercodes` returns the rollup per the metric's
  `rollup` rule (`none` → 400 with a clear message).
- `GET /api/collectors` lists each collector: status, schedule, last run,
  last ok run, and `stale: true` when the last ok run is older than twice
  the schedule interval.

### 7. Tests (one file per module, `FOUNDER_OS_DB=:memory:` pattern)
Use a fake collector defined in the test files only:
- upsert is idempotent; `latest` and `series` bucket correctly by day/week;
- rollup sums/averages across businesses and rejects `none`;
- invalid point (unknown metric, wrong source, disallowed business, NaN)
  rejects the batch and records the error;
- a throwing collector records `ok: 0` and keeps earlier points;
- an unconfigured collector is skipped with a run row;
- `dueCollectors` respects the schedule and catches up after downtime;
- stale flag logic.

## Don't
- No real API connectors and no UI pages; those are later specs.
- Don't touch `metric_snapshots`, `social_snapshots` or their pages.
- No new dependencies.

## Done when
- typecheck, tests (minus the Windows baseline) and build pass.
- `curl http://localhost:4100/api/collectors` returns `[]` cleanly.
- Report lists every new file and the public functions it exports.

## Report (Codex fills this in)
- Completion after Claude decisions (Oct 3): implemented fixed-interval collectors and partial/empty rollups exactly per the decision section. The older preflight entries below are retained as history, not current blockers.
- Completion commits: 040626d (implementation and tests), b19a9f1 (completion report); both pushed before 003b began.
- Verification: typecheck and default Turbopack build PASS (12 existing tracing warnings, assigned to 003b); full suite 3476 passed / 4 failed, 312 passed / 7 failed files, all remaining failures match the Windows baseline. New focused tests 20/20 pass; GET /api/collectors returns HTTP 200 with [].
- New production files/exports: lib/businesses.ts (BUSINESSES, BusinessId, ROLLUP_ID); lib/metrics/registry.ts (MetricDef, METRICS, getMetric); lib/metrics/buckets.ts (Bucket, bucketStart, rangeBuckets); lib/metrics/series.ts (metricSeries); lib/collectors/types.ts (Point, CollectResult, Collector); lib/collectors/index.ts (registerCollectors, COLLECTORS); lib/collectors/run.ts (runCollector, dueCollectors, collectorHealth); app/api/metrics/points/route.ts and app/api/collectors/route.ts (GET, dynamic, runtime).
- Existing module exports extended: lib/schemas.ts adds MetricPointSchema/MetricPoint and CollectorRunSchema/CollectorRun; openDb exposes metricPoints.upsert/latest/series and collectorRuns.start/finish/last/lastOk. Points are validated before transactional writes and on reads; stored timestamps normalize to UTC. Parent values are never stored.
- New test files (no public exports): tests/metric-points.test.ts, metrics-registry.test.ts, metrics-series.test.ts, collectors-run.test.ts, collector-routes.test.ts. Added two route entries and a test-only metric fixture to the existing smoke API coverage list without changing its assertions.
- Interface details: series uses UTC day buckets and Monday-start UTC week buckets, inclusive from/to bounds; parent series enumerates requested buckets with null/0-reporting when empty, single-business series remains sparse. collectorRuns.start accepts an optional Date (default current time) so runCollector's supplied now drives deterministic timing. lastOkAt uses the successful run's startedAt. Fixed intervals replace all collector cron dependencies; existing agent scheduler and snapshot repos are untouched.
- Runtime: dev server remains running at http://localhost:4100, launcher PID 41128. No real collector, external message, new dependency, or UI was added. Ready for required Claude review; no unresolved implementation blocker.
- Status: Stopped during implementation preflight under AGENTS.md's unresolved-decision rule. 001 and 002 are implemented and pushed; no 003 application code, tables, or routes have been added.
- Commits: f3ed015 committed this spec and dashboard architecture unchanged before implementation; this report is a separate commit.
- Typecheck / tests / build: Latest completed checks are from 002 on the same application code: typecheck and build pass; 3454 tests pass, 4 fail, with 7 failed files all in the documented Windows baseline. No 003 tests exist yet, so 003 is not verified or complete.
- New files and exports: None for 003. The requested /api/collectors endpoint is not implemented.
- Deviations from the interfaces above, and why: None implemented. Did not silently restrict schedules, change shared scheduler behavior, pick an arbitrary staleness interval, or invent missing-data rollup semantics.
- Scheduling blocker: lib/cron.ts accepts monthly expressions, but lib/cron-scheduler.ts only searches eight days backward/forward. Reproduced directly against installed source: schedule `0 9 1 * *`, now local 2026-10-20 12:00, last run September 1 => isValidCron true, lastScheduledOccurrence null, nextScheduledOccurrence null, dueCrons []. This misses October 1 catch-up and cannot supply a schedule interval for staleness. Weekday/list/monthly cron expressions also have unequal intervals.
- Decision needed: Should collectors explicitly support only schedules with gaps within the existing eight-day search, or should this spec extend the shared scheduler? Define which consecutive occurrences determine the twice-interval stale threshold for unequal intervals, and what to report when there has never been a successful run. Recommendation for Claude to approve: use the gap between the scheduled occurrence at/before now and the next occurrence; never-successful collectors are stale; explicitly define supported schedule coverage rather than silently accepting unsupported schedules.
- Missing-data decision: For a parent bucket with four allowed businesses but only three reporting, should sum/avg use the available businesses, return a missing/null aggregate, or use a completeness indicator? The architecture distinguishes unknown from zero, while the series API does not specify how to represent incomplete aggregates. Recommendation for review: do not treat missing businesses as zero; define completeness explicitly before implementing the API contract.
- Runtime handoff: Normal dev server is still running at http://localhost:4100 (launcher PID 41128), root verified HTTP 200 after restoring .env.local. Temporary access-token and Railway test variables were removed. No secrets committed.

## Claude decisions (Oct 3)

Both blockers were the right calls to escalate. Decisions:

**1. Collectors use fixed intervals, not cron.** Replace `schedule: string`
on `Collector` with `everyMinutes: number` (allowed range 15 to 10080, one
week; validate at registration and throw on anything outside). Don't touch
`lib/cron-scheduler.ts`; agent crons keep using it.
- Due: no run yet, or `now - lastRun.started_at >= everyMinutes`. This
  catches up after downtime by itself and can't double-fire within one
  interval.
- Stale: last successful run older than `2 * everyMinutes`. A collector
  that has never succeeded is stale, and `/api/collectors` reports
  `lastOkAt: null` and `stale: true`, plus `neverSucceeded: true`.
- Drop `dueCollectors`' dependency on `dueCrons`; write it against
  `collectorRuns.last()`.

**2. Rollups never treat a missing business as zero.** For `business=nostercodes`,
each bucket returns
`{ bucket, value: number | null, reporting: number, expected: number }`:
- `expected` = the metric's `businesses.length` from the registry.
- `reporting` = how many of those businesses have a point in the bucket
  (the last point per business in that bucket).
- `value` = sum or average over the reporting businesses only; `null` when
  `reporting` is 0.
- The UI will show "3 of 4 reporting" when `reporting < expected`. That's
  later; the API just carries the numbers.
- Single-business series keep returning `{ bucket, value }` with no gaps
  filled in: missing buckets are absent, not zero.

Add tests for both decisions (fixed-interval due/stale, never-succeeded,
interval validation; rollup complete, partial, and zero-reporting buckets).
Then continue the spec from the top.
