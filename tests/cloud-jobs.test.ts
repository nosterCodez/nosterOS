import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { saveCredential } from '@/lib/creds';
import { configureSource } from '@/lib/cloud-sources';
import { runCloudTick } from '@/lib/cloud-jobs';
const mocks = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), collect: vi.fn() }));
vi.mock('@/lib/workspace-jobs', () => ({ listWorkspaces: mocks.list }));
vi.mock('@/lib/workspace-storage', () => ({ withWorkspaceDb: (id: string, work: (db: unknown) => unknown) => work(mocks.open(id)) }));
vi.mock('@/lib/cloud-adapters', () => ({ collectCloud: mocks.collect }));
const A = 'A'.repeat(32), B = 'B'.repeat(32);
let dbs: Map<string, ReturnType<typeof openDb>>;
beforeEach(() => {
  vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  dbs = new Map([[A, openDb(':memory:')], [B, openDb(':memory:')]]); mocks.open.mockImplementation(id => dbs.get(id)); mocks.list.mockResolvedValue([{ id: A, name: 'A', kind: 'client' }, { id: B, name: 'B', kind: 'client' }]);
  for (const [id, db] of dbs) { const ctx = { workspace: { id }, db }; saveCredential(ctx, 'STRIPE_SECRET_KEY', 'rk_test_fixture'); configureSource(ctx, 'stripe', { resource: '', enabled: true }); }
});
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('failed workspace does not stop the next; snapshots/points go to the correct database; due work is claimed once', async () => {
  mocks.collect.mockImplementation(async ctx => { if (ctx.workspace.id === A) throw new Error('private-token'); return { at: new Date().toISOString(), period: 'fixture', values: { gross: 19 } }; });
  expect(await runCloudTick()).toEqual({ ran: 2 });
  expect(dbs.get(A)!.metricPoints.latest('cloud.stripe.gross', 'workspace')).toBeNull();
  expect(dbs.get(B)!.metricPoints.latest('cloud.stripe.gross', 'workspace')?.value).toBe(19);
  expect(await runCloudTick()).toEqual({ ran: 0 }); expect(mocks.collect).toHaveBeenCalledTimes(2);
  expect(dbs.get(A)!.cloudSources.get('stripe')?.error).not.toContain('private-token');
});
test('overlapping ticks skip instead of performing duplicate reads', async () => {
  let release!: () => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]); }));
  const first = runCloudTick();
  expect(await runCloudTick()).toMatchObject({ skipped: 'already running' }); release(); await first;
});
