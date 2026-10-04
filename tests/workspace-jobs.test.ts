import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { closeWorkspaceStores, openWorkspaceDb } from '@/lib/workspace-storage';
import { forEachWorkspace, workspaceJob, listWorkspaces } from '@/lib/workspace-jobs';
import { apiOperatorWorkspace as apiWorkspace } from '@/lib/session';
import { operatorWorkspaceId } from '@/lib/operator-workspace';

vi.unmock('@/lib/workspace-jobs');
const state = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({}) }));
vi.mock('@/lib/operator-workspace', () => ({ operatorWorkspaceId: vi.fn(() => 'A'.repeat(32)) }));
const A = 'A'.repeat(32), B = 'B'.repeat(32), C = 'C'.repeat(32);
let root: string;
function setup() {
  vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', '1');
  root = mkdtempSync(path.join(tmpdir(), 'nosteros-jobs-'));
  vi.stubEnv('DATA_DIR', root); vi.stubEnv('DEMO_GATE', '');
  vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'test-only-secret');
  state.headers = new Headers();
}
afterEach(() => {
  closeWorkspaceStores(); vi.unstubAllEnvs(); vi.clearAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
});

test('one failing workspace does not stop other jobs or mix their data', async () => {
  setup(); const log = vi.fn();
  const results = await forEachWorkspace([A, B, C].map(id => ({ id, name: id, kind: 'agency' as const })), async ({ workspace, db }) => {
    if (workspace.id === B) throw new Error('private upstream details');
    db.meta.set('job-owner', workspace.id);
    return workspace.id;
  }, log);
  expect(results.map(row => row.ok)).toEqual([true, false, true]);
  expect(results[1].error).toBe('Workspace job failed');
  expect(openWorkspaceDb(A).meta.get('job-owner')).toBe(A);
  expect(openWorkspaceDb(B).meta.get('job-owner')).toBeNull();
  expect(openWorkspaceDb(C).meta.get('job-owner')).toBe(C);
  for (const id of [A, B, C]) expect(log.mock.calls.some(([line]) => line.includes(`[workspace:${id}]`))).toBe(true);
});

test('member requests are scoped to the active workspace; failures cannot fan out', async () => {
  setup();
  vi.mocked(apiWorkspace).mockResolvedValueOnce({ workspace: { id: A, name: 'A', kind: 'agency' }, db: openWorkspaceDb(A), user: { id: 'user', email: 'test@example.com', name: 'Test' }, role: 'owner' });
  const work = vi.fn(async ({ workspace }: { workspace: { id: string } }) => workspace.id);
  const response = await workspaceJob('/api/cron/tick', work);
  expect(await response.json()).toBe(A); expect(work).toHaveBeenCalledTimes(1);
  state.headers.set('x-nosteros-internal', 'wrong');
  vi.mocked(apiWorkspace).mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
  expect((await workspaceJob('/api/cron/tick', work)).status).toBe(401);
  expect(work).toHaveBeenCalledTimes(1);
});

test('internal connector jobs run only for the bound operator, never other workspaces', async () => {
  setup();
  const control = new Database(path.join(root, 'control.db'));
  control.exec('CREATE TABLE organization (id TEXT, name TEXT, metadata TEXT)');
  for (const id of [A, B]) control.prepare('INSERT INTO organization VALUES (?, ?, ?)').run(id, id, JSON.stringify({ kind: 'agency' }));
  control.close();
  state.headers.set('x-nosteros-internal', 'test-only-secret');
  const work = vi.fn(async ({ workspace }: { workspace: { id: string } }) => workspace.id);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const response = await workspaceJob('/api/cron/tick', work);
    const body = await response.json();
    expect(body.workspaces.map((row: { workspaceId: string }) => row.workspaceId)).toEqual([A]);
    expect(apiWorkspace).not.toHaveBeenCalled();
    vi.mocked(apiWorkspace).mockResolvedValueOnce(Response.json({}, { status: 401 }));
    expect((await workspaceJob('/api/other', work)).status).toBe(401);
    expect(work).toHaveBeenCalledTimes(1);
    vi.mocked(operatorWorkspaceId).mockReturnValueOnce(null);
    expect(await (await workspaceJob('/api/cron/tick', work)).json()).toEqual({ ok: true, skipped: 'operator-unavailable', workspaces: [] });
    expect(work).toHaveBeenCalledTimes(1);
  } finally { log.mockRestore(); }
});

test('malformed workspace metadata cannot stop valid job discovery', async () => {
  setup();
  const control = new Database(path.join(root, 'control.db'));
  control.exec('CREATE TABLE organization (id TEXT, name TEXT, metadata TEXT)');
  control.prepare('INSERT INTO organization VALUES (?, ?, ?)').run(A, 'A', '{"kind":"agency"}');
  control.prepare('INSERT INTO organization VALUES (?, ?, ?)').run(B, 'B', 'invalid');
  control.close();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect((await listWorkspaces()).map(w => w.id)).toEqual([A]);
    expect(warning).toHaveBeenCalledWith(`[workspace:${B}] invalid metadata; job skipped`);
  } finally { warning.mockRestore(); }
});
test('internal host ticks quietly skip when operator features are disabled', async () => {
  setup(); vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', '');
  state.headers.set('x-nosteros-internal', 'test-only-secret');
  const work = vi.fn();
  expect(await (await workspaceJob('/api/cron/tick', work)).json()).toEqual({ ok: true, skipped: 'operator-features-disabled', workspaces: [] });
  expect(work).not.toHaveBeenCalled();
  expect(operatorWorkspaceId).not.toHaveBeenCalled();
});
