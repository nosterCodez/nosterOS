import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { workspaceDir } from '@/lib/paths';
import { openWorkspaceDb, openWorkspaceBank, openWorkspacePaykit, closeWorkspaceStores } from '@/lib/workspace-storage';
import { HandlePool } from '@/lib/handle-pool';

const directories: string[] = [];
afterEach(() => { closeWorkspaceStores(); vi.unstubAllEnvs(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'nosteros-workspace-test-')); directories.push(root); vi.stubEnv('DATA_DIR', root); vi.stubEnv('DEMO_GATE', '');
}
const A = 'A'.repeat(32), B = 'B'.repeat(32);
test('workspace paths accept only Better Auth default 32-character alphanumeric ids', () => {
  setup();
  for (const id of ['', '../', '/tmp/escape', 'C:\\escape', '..'.repeat(16), 'a/b', 'a'.repeat(31), 'a'.repeat(33)]) expect(() => workspaceDir(id)).toThrow();
  expect(workspaceDir(A)).toBe(path.join(process.env.DATA_DIR!, 'workspaces', A));
});
test('workspaces have separate app and bank files', () => {
  setup(); const a = openWorkspaceDb(A), b = openWorkspaceDb(B);
  a.meta.set('isolation-sentinel', 'only-a'); b.meta.set('isolation-sentinel', 'only-b');
  expect(a.meta.get('isolation-sentinel')).toBe('only-a'); expect(b.meta.get('isolation-sentinel')).toBe('only-b');
  openWorkspaceBank(A).upsert({ account: 'test', business: 'a', month: '2026-10', creditsCents: 100, debitsCents: 20, netCents: 80 });
  expect(openWorkspaceBank(A).all()).toHaveLength(1); expect(openWorkspaceBank(B).all()).toHaveLength(0);
});
test('new workspaces contain structural records but no demonstration records', () => {
  setup(); const db = openWorkspaceDb(A);
  expect(db.agents.all().length).toBeGreaterThan(0); expect(db.departments.all().length).toBeGreaterThan(0);
  const raw = new Database(path.join(workspaceDir(A), 'nosteros.db'), { readonly: true });
  try {
    for (const table of ['people','lead_magnets','agent_runs','metrics','social_accounts','social_snapshots','funnel_contacts','funnel_touches']) {
      expect((raw.prepare(`SELECT count(*) AS count FROM "${table}"`).get() as {count:number}).count, table).toBe(0);
    }
  } finally { raw.close(); }
});
test('LRU delays closing the least recently used handle until its grace period expires', () => {
  vi.useFakeTimers();
  const closed: string[] = [];
  const pool = new HandlePool((key: string) => ({ key, close: () => { closed.push(key); } }), 2);
  pool.get('a'); pool.get('b'); pool.get('a'); pool.get('c');
  expect(closed).toEqual([]); expect(pool.size).toBe(2);
  vi.advanceTimersByTime(60_000); expect(closed).toEqual(['b']);
  pool.closeAll(); expect(closed).toEqual(['b', 'a', 'c']);
  vi.useRealTimers();
});
test('workspace payment history does not install invented historical customers', () => {
  setup();
  expect(openWorkspacePaykit(A, 'paykit-lc').snapshots()).toEqual([]);
  expect(openWorkspacePaykit(B, 'paykit-lc').snapshots()).toEqual([]);
});
