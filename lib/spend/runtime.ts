import fs from 'node:fs';
import { z } from 'zod';
import { spendDbPath } from '@/lib/paths';
import { openSpendLedger } from './ledger';

export function runSpendTick(env: Record<string, string | undefined> = process.env, now = new Date()) {
  const filename = spendDbPath(env);
  if (!fs.existsSync(filename)) return { status: 'skipped' as const };
  try {
    const ledger = openSpendLedger(filename, env);
    try { return { status: 'ok' as const, expired: ledger.expire(now) }; }
    finally { ledger.close(); }
  } catch { return { status: 'failed' as const, error: 'Spending recovery unavailable.' }; }
}

/** Called only with the authenticated active workspace, not client-supplied filters. */
export function workspaceSpendUsage(workspaceId: string, env: Record<string, string | undefined> = process.env, now = new Date()) {
  z.string().regex(/^[A-Za-z0-9]{32}$/).parse(workspaceId);
  const month = now.toISOString().slice(0, 7), filename = spendDbPath(env);
  if (!fs.existsSync(filename)) return { month, rows: [], alerts: [] };
  const ledger = openSpendLedger(filename, env);
  try { const workspace = ledger.forWorkspace(workspaceId); return { month, rows: workspace.rows(month), alerts: workspace.alerts(month) }; }
  finally { ledger.close(); }
}
