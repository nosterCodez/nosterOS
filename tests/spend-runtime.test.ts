import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, expect, test, vi } from 'vitest';
import { openSpendLedger } from '@/lib/spend/ledger';
import { runSpendTick, workspaceSpendUsage } from '@/lib/spend/runtime';
const a = 'a'.repeat(32), b = 'b'.repeat(32), now = new Date('2026-10-06T12:00:00Z');
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function root() { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-spend-runtime-')); roots.push(value); return value; }
test('tick is inert without a spending DB; expiry recovers abandoned reservations', () => {
  const data = root(), env = { DATA_DIR: data };
  expect(runSpendTick(env, now)).toMatchObject({ status: 'skipped' });
  expect(fs.readdirSync(data)).toEqual([]);
  const ledger = openSpendLedger(path.join(data, 'platform', 'spend.db'));
  ledger.forWorkspace(a).reserve({ feature: 'lead_plan', provider: 'openai', pool: 'byo_ai', payer: 'byo', units: 100, estimatedUsd: 1, ttlMs: 1 }, now);
  ledger.close();
  expect(runSpendTick(env, new Date(now.getTime() + 10))).toEqual({ status: 'ok', expired: 1 });
  expect(workspaceSpendUsage(a, env, now).rows[0]).toMatchObject({ status: 'expired', actualUsd: 1 });
  expect(workspaceSpendUsage(b, env, now).rows).toEqual([]);
});
test('usage route binds the session workspace; expiry is behind internal authentication', () => {
  const usage = fs.readFileSync('app/api/usage/route.ts', 'utf8');
  expect(usage).toContain('workspaceSpendUsage(workspace.workspace.id');
  const tick = fs.readFileSync('app/api/cron/tick/route.ts', 'utf8');
  expect(tick).toMatch(/if \(internal\) runSpendTick\(\)/);
  expect(tick.indexOf('if (authError) return authError;', tick.indexOf('export async function POST'))).toBeLessThan(tick.indexOf('runSpendTick();'));
});
test('independent workers race a global cap with two real SQLite connections', async () => {
  const filename = path.join(root(), 'spend.db'), env = { OMEGA_PLATFORM_AI_MONTHLY_USD: '1' };
  const setup = openSpendLedger(filename, env);
  for (const id of [a, b]) setup.forWorkspace(id).setCap('platform_ai', 2, { id: 'owner', role: 'owner' });
  setup.close();
  const barrier = new SharedArrayBuffer(4);
  const workers = [a, b].map(id => new Worker(`
    require('tsx/cjs');
    const { parentPort, workerData } = require('node:worker_threads');
    const { openSpendLedger } = require(workerData.module);
    const ledger = openSpendLedger(workerData.filename, workerData.env);
    parentPort.postMessage('ready');
    Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
    const result = ledger.forWorkspace(workerData.id).reserve({feature:'lead_plan',provider:'openai',payer:'platform',pool:'platform_ai',units:10,estimatedUsd:0.75});
    ledger.close(); parentPort.postMessage(result);
  `, { eval: true, workerData: { module: path.resolve('lib/spend/ledger.ts'), filename, env, id, barrier } }));
  try {
    let ready = 0;
    const results = await Promise.all(workers.map(worker => new Promise<{ ok: boolean }>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => {
        if (message === 'ready') { if (++ready === 2) { Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0); } }
        else resolve(message);
      });
      worker.on('exit', code => { if (code) reject(new Error('Worker failed')); });
    })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}, 15_000);
