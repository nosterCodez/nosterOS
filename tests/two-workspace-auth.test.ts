import { afterAll, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import type { SystemMessage } from '@/lib/system-mail';

vi.unmock('@/lib/session');
const state = vi.hoisted(() => ({ auth: null as unknown }));
vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getAuth: async () => state.auth,
}));
import { createAuth } from '@/lib/auth';
import { requireWorkspace, withWorkspaceLease } from '@/lib/session';
import { closeWorkspaceStores } from '@/lib/workspace-storage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nosteros-two-users-'));
const control = new Database(':memory:');
const messages: SystemMessage[] = [];
const baseURL = 'http://localhost:4100';
const auth = createAuth(control, { baseURL, secret: 'test-only-secret-at-least-thirty-two-characters', send: async message => { messages.push(message); } });
state.auth = auth;
afterAll(() => {
  closeWorkspaceStores(); control.close(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

test('real unrelated accounts resolve separate data and cannot switch into each other', async () => {
  vi.stubEnv('DATA_DIR', root); vi.stubEnv('DEMO_GATE', '');
  await (await getMigrations(auth.options)).runMigrations();
  async function account(email: string, slug: string) {
    await auth.api.signInMagicLink({ headers: new Headers({ origin: baseURL }), body: { email, callbackURL: '/' } });
    const response = await auth.handler(new Request(messages.at(-1)!.url));
    const headers = new Headers({ origin: baseURL, cookie: response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') });
    const org = await auth.api.createOrganization({ headers, body: { name: slug, slug, metadata: { kind: 'client' } } });
    await auth.api.setActiveOrganization({ headers, body: { organizationId: org!.id } });
    return { headers, id: org!.id };
  }
  const a = await account('workspace-a@example.com', 'workspace-a');
  const b = await account('workspace-b@example.com', 'workspace-b');
  const ca = await requireWorkspace('owner', a.headers, 'api');
  const cb = await requireWorkspace('owner', b.headers, 'api');
  expect(ca.workspace.id).toBe(a.id); expect(cb.workspace.id).toBe(b.id);
  await withWorkspaceLease(ca, async db => { db.meta.set('qa-isolation', 'A only'); await Promise.resolve(); expect(db.meta.get('qa-isolation')).toBe('A only'); });
  expect(cb.db.meta.get('qa-isolation')).toBeNull();
  cb.db.meta.set('qa-isolation', 'B only');
  expect(ca.db.meta.get('qa-isolation')).toBe('A only');
  for (const [visitor, target] of [[a, b], [b, a]]) {
    await expect(auth.api.setActiveOrganization({ headers: visitor.headers, body: { organizationId: target.id } })).rejects.toThrow();
    // Better Auth may clear the active organization after a rejected switch.
    expect((await auth.api.getSession({ headers: visitor.headers }))?.session.activeOrganizationId).not.toBe(target.id);
    await auth.api.setActiveOrganization({ headers: visitor.headers, body: { organizationId: visitor.id } });
    expect((await requireWorkspace('viewer', visitor.headers, 'api')).workspace.id).toBe(visitor.id);
  }
  expect(fs.readdirSync(path.join(root, 'workspaces')).sort()).toEqual([a.id, b.id].sort());
}, 20_000);
