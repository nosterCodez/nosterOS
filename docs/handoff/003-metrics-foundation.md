# 003: Metric store, registry and collector framework

Status: ready (after 001)
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
- Status:
- Commits:
- Typecheck / tests / build:
- New files and exports:
- Deviations from the interfaces above, and why:
- Questions or blockers for Claude:
