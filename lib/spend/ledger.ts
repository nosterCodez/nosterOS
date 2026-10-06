import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { spendDbPath } from '@/lib/paths';

const Workspace = z.string().regex(/^[A-Za-z0-9]{32}$/);
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Money = z.number().finite().nonnegative().max(1_000_000);
const Units = z.number().int().nonnegative().max(1_000_000_000);
export const SpendPool = z.enum(['byo_ai', 'byo_paid_data', 'platform_ai', 'platform_paid_data', 'free_quota']);
export type SpendPool = z.infer<typeof SpendPool>;
const Payer = z.enum(['byo', 'platform']);
const Label = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const Reservation = z.object({ feature: Label, provider: Label, payer: Payer, pool: SpendPool,
  units: Units, estimatedUsd: Money, ttlMs: z.number().int().min(1).max(600_000).default(600_000) }).strict();
type Reservation = z.input<typeof Reservation>;
const Row = z.object({ id: z.string().uuid(), workspaceId: Workspace, feature: Label, provider: Label,
  payer: Payer, pool: SpendPool, units: Units, estimatedUsd: Money, actualUsd: Money.nullable(),
  status: z.enum(['reserved', 'committed', 'released', 'expired']), month: Month,
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), settledAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable() }).strict();
const Alert = z.object({ scope: z.string(), month: Month, threshold: z.union([z.literal(50), z.literal(80), z.literal(100)]), createdAt: z.string().datetime() }).strict();
type Result = { ok: true; id: string } | { ok: false; reason: 'workspace_cap' | 'global_cap' };
const SELECT = `SELECT id, workspace_id AS workspaceId, feature, provider, payer, pool, units,
 estimated_usd AS estimatedUsd, actual_usd AS actualUsd, status, month, created_at AS createdAt,
 expires_at AS expiresAt, settled_at AS settledAt, error_code AS errorCode FROM spend_ledger`;
const micro = (usd: number) => Math.ceil(usd * 1_000_000);
const positiveEnv = (s: string | undefined) => s && /^\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s)) && Number(s) <= 1_000_000 ? Number(s) : 0;

/** Server-only authority. Consumers bind session.workspace.id, never a request parameter. */
export function openSpendLedger(filename = spendDbPath(), env: Record<string, string | undefined> = process.env) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename, { timeout: 5000 });
  db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS spend_ledger (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, feature TEXT NOT NULL, provider TEXT NOT NULL,
    payer TEXT NOT NULL CHECK(payer IN ('byo','platform')), pool TEXT NOT NULL,
    units INTEGER NOT NULL CHECK(units>=0), estimated_usd REAL NOT NULL CHECK(estimated_usd>=0), actual_usd REAL,
    status TEXT NOT NULL CHECK(status IN ('reserved','committed','released','expired')), month TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, settled_at TEXT, error_code TEXT);
    CREATE INDEX IF NOT EXISTS spend_global ON spend_ledger(month,payer,status);
    CREATE INDEX IF NOT EXISTS spend_workspace ON spend_ledger(workspace_id,month,status);
    CREATE TABLE IF NOT EXISTS spend_alerts(scope TEXT NOT NULL,month TEXT NOT NULL,threshold INTEGER NOT NULL,
      created_at TEXT NOT NULL,UNIQUE(scope,month,threshold));
    CREATE TABLE IF NOT EXISTS spend_caps(workspace_id TEXT NOT NULL,pool TEXT NOT NULL,monthly_usd REAL NOT NULL,
      updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(workspace_id,pool));`);

  function freeCap(provider: string) {
    return provider === 'google_places' ? Math.floor(positiveEnv(env.OMEGA_GOOGLE_PLACES_FREE_CALLS)) : 0;
  }
  function cap(workspace: string, pool: SpendPool, provider: string) {
    if (pool === 'free_quota') return freeCap(provider);
    const row = db.prepare('SELECT monthly_usd FROM spend_caps WHERE workspace_id=? AND pool=?').get(workspace, pool) as { monthly_usd: number } | undefined;
    return Math.floor(Money.parse(row?.monthly_usd ?? (pool === 'byo_ai' ? 5 : 0)) * 1_000_000);
  }
  function globalCap(pool: SpendPool, provider: string) {
    if (pool === 'free_quota') return freeCap(provider);
    return Math.floor(positiveEnv(env[pool === 'platform_ai' ? 'OMEGA_PLATFORM_AI_MONTHLY_USD' : 'OMEGA_LEAD_GLOBAL_MONTHLY_USD']) * 1_000_000);
  }
  function total(workspace: string | null, pool: SpendPool, month: string, provider: string) {
    const expression = pool === 'free_quota' ? 'units' : "CAST(ROUND((CASE WHEN status='reserved' THEN estimated_usd ELSE actual_usd END)*1000000) AS INTEGER)";
    const bindings: string[] = [pool, month];
    let clause = '';
    if (workspace) { clause += ' AND workspace_id=?'; bindings.push(workspace); }
    if (pool === 'free_quota') { clause += ' AND provider=?'; bindings.push(provider); }
    const value = db.prepare(`SELECT COALESCE(SUM(${expression}),0) AS value FROM spend_ledger WHERE pool=? AND month=? AND status IN ('reserved','committed','expired')${clause}`).get(...bindings) as { value: number };
    return z.number().finite().nonnegative().parse(value.value);
  }
  function thresholds(scope: string, month: string, used: number, limit: number, timestamp: string) {
    if (limit <= 0) return;
    for (const threshold of [50, 80, 100]) if (used >= limit * threshold / 100) {
      db.prepare('INSERT OR IGNORE INTO spend_alerts(scope,month,threshold,created_at) VALUES (?,?,?,?)').run(scope, month, threshold, timestamp);
    }
  }
  function alertsFor(row: z.infer<typeof Row>, now: string) {
    thresholds(row.workspaceId, row.month, total(row.workspaceId, row.pool, row.month, row.provider), cap(row.workspaceId, row.pool, row.provider), now);
    if (row.payer === 'platform' || row.pool === 'free_quota') thresholds(`global:${row.pool}`, row.month,
      total(null, row.pool, row.month, row.provider), globalCap(row.pool, row.provider), now);
  }
  function expire(now = new Date()) {
    return db.transaction(() => db.prepare("UPDATE spend_ledger SET status='expired',actual_usd=estimated_usd,settled_at=?,error_code='reservation_expired' WHERE status='reserved' AND expires_at<=?")
      .run(now.toISOString(), now.toISOString()).changes).immediate();
  }
  function forWorkspace(id: string) {
    const workspaceId = Workspace.parse(id);
    const get = (id: string) => { const row = db.prepare(`${SELECT} WHERE workspace_id=? AND id=?`).get(workspaceId, z.string().uuid().parse(id)); return row ? Row.parse(row) : null; };
    return {
      reserve(input: Reservation, now = new Date()): Result {
        const r = Reservation.parse(input), timestamp = now.toISOString(), month = timestamp.slice(0, 7);
        if ((r.pool.startsWith('platform_') && r.payer !== 'platform') || (r.pool.startsWith('byo_') && r.payer !== 'byo')
          || (r.pool === 'free_quota' && (r.estimatedUsd !== 0 || r.units < 1))
          || (r.pool !== 'free_quota' && r.estimatedUsd <= 0)) throw new Error('Invalid spend pool');
        const estimate = micro(r.estimatedUsd), amount = r.pool === 'free_quota' ? r.units : estimate;
        return db.transaction((): Result => {
          const wsCap = cap(workspaceId, r.pool, r.provider), wsTotal = total(workspaceId, r.pool, month, r.provider);
          if (wsCap <= 0 || wsTotal + amount > wsCap) return { ok: false, reason: 'workspace_cap' };
          if (r.payer === 'platform' || r.pool === 'free_quota') {
            const limit = globalCap(r.pool, r.provider);
            if (limit <= 0 || total(null, r.pool, month, r.provider) + amount > limit) return { ok: false, reason: 'global_cap' };
          }
          const id = randomUUID();
          db.prepare(`INSERT INTO spend_ledger(id,workspace_id,feature,provider,payer,pool,units,estimated_usd,status,month,created_at,expires_at)
            VALUES (?,?,?,?,?,?,?,?,'reserved',?,?,?)`).run(id, workspaceId, r.feature, r.provider, r.payer, r.pool, r.units, estimate / 1_000_000, month, timestamp, new Date(now.getTime() + r.ttlMs).toISOString());
          alertsFor(get(id)!, timestamp);
          return { ok: true, id };
        }).immediate();
      },
      commit(id: string, actualUsd: number, units?: number, now = new Date()) {
        const actual = micro(Money.parse(actualUsd)) / 1_000_000;
        if (units !== undefined) Units.parse(units);
        return db.transaction(() => {
          const row = get(id); if (!row || !['reserved', 'expired'].includes(row.status)) return false;
          if (row.pool === 'free_quota' && (actual !== 0 || (units !== undefined && units !== row.units))) throw new Error('Invalid quota settlement');
          db.prepare("UPDATE spend_ledger SET status='committed',actual_usd=?,units=?,settled_at=?,error_code=NULL WHERE id=? AND workspace_id=?")
            .run(actual, units ?? row.units, now.toISOString(), id, workspaceId);
          alertsFor(get(id)!, now.toISOString()); return true;
        }).immediate();
      },
      release(id: string, code: 'request_not_sent', now = new Date()) {
        // No provider errors are allowlisted as unbilled yet; transport failures remain reserved.
        z.literal('request_not_sent').parse(code); z.string().uuid().parse(id);
        return db.prepare("UPDATE spend_ledger SET status='released',actual_usd=0,settled_at=?,error_code=? WHERE workspace_id=? AND id=? AND status='reserved'")
          .run(now.toISOString(), code, workspaceId, id).changes === 1;
      },
      rows(month = new Date().toISOString().slice(0, 7)) {
        return z.array(Row).parse(db.prepare(`${SELECT} WHERE workspace_id=? AND month=? ORDER BY created_at,id`).all(workspaceId, Month.parse(month)));
      },
      alerts(month = new Date().toISOString().slice(0, 7)) {
        return z.array(Alert).parse(db.prepare('SELECT scope,month,threshold,created_at AS createdAt FROM spend_alerts WHERE scope=? AND month=? ORDER BY threshold').all(workspaceId, Month.parse(month)));
      },
      setCap(pool: Exclude<SpendPool, 'free_quota'>, monthlyUsd: number, actor: { id: string; role: string }, now = new Date()) {
        if (!['owner', 'admin'].includes(actor.role)) throw new Error('Owner or admin required');
        SpendPool.exclude(['free_quota']).parse(pool); Money.parse(monthlyUsd);
        if (pool === 'byo_ai' && monthlyUsd > 100) throw new Error('BYO AI cap must be at most 100');
        z.string().min(1).max(200).parse(actor.id);
        db.prepare('INSERT INTO spend_caps VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,pool) DO UPDATE SET monthly_usd=excluded.monthly_usd,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
          .run(workspaceId, pool, monthlyUsd, actor.id, now.toISOString());
      },
    };
  }
  return { forWorkspace, expire, close: () => db.close() };
}
export type SpendLedger = ReturnType<typeof openSpendLedger>;
