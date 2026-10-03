import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '@/lib/auth';
import type { SystemMessage } from '@/lib/system-mail';

const db = new Database(':memory:');
const messages: SystemMessage[] = [];
const baseURL = 'http://localhost:4100';
const auth = createAuth(db, { baseURL, secret: 'local-test-secret-32-characters-minimum-only', send: async message => { messages.push(message); } });
let owner: Headers;
let viewer: Headers;
let workspaceId: string;
async function signIn(email: string) {
  await auth.api.signInMagicLink({ headers: new Headers({ origin: baseURL }), body: { email, callbackURL: '/' } });
  const link = messages.at(-1)!;
  const response = await auth.handler(new Request(link.url));
  const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return new Headers({ cookie: cookies, origin: baseURL });
}
beforeAll(async () => { await (await getMigrations(auth.options)).runMigrations(); });
afterAll(() => db.close());
describe('real Better Auth accounts and workspaces', () => {
  test('magic-link signup creates a user; links are single use', async () => {
    owner = await signIn('owner@example.com');
    expect((await auth.api.getSession({ headers: owner }))?.user.email).toBe('owner@example.com');
    const repeated = await auth.handler(new Request(messages.at(-1)!.url));
    expect(repeated.headers.getSetCookie().some(c => c.includes('session_token='))).toBe(false);
  });
  test('workspace creator is owner with approved kind metadata', async () => {
    const org = await auth.api.createOrganization({ headers: owner, body: { name: 'Test workspace', slug: 'test-workspace', metadata: { kind: 'agency' } } });
    workspaceId = org!.id;
    await auth.api.setActiveOrganization({ headers: owner, body: { organizationId: workspaceId } });
    expect((await auth.api.getActiveMember({ headers: owner })).role).toBe('owner');
  });
  test('invitation acceptance grants the invited role, not ownership', async () => {
    const invite = await auth.api.createInvitation({ headers: owner, body: { email: 'viewer@example.com', role: 'viewer', organizationId: workspaceId } });
    const stored = db.prepare('SELECT typeof(expiresAt) AS storageType, expiresAt FROM invitation WHERE id=?').get(invite.id) as { storageType: string; expiresAt: string };
    expect(stored.storageType).toBe('text');
    expect(Date.parse(stored.expiresAt)).toBeGreaterThan(Date.now());
    viewer = await signIn('viewer@example.com');
    await auth.api.acceptInvitation({ headers: viewer, body: { invitationId: invite.id } });
    await auth.api.setActiveOrganization({ headers: viewer, body: { organizationId: workspaceId } });
    expect((await auth.api.getActiveMember({ headers: viewer })).role).toBe('viewer');
  });
  test('viewer cannot invite (403)', async () => {
    const response = await auth.handler(new Request(`${baseURL}/api/auth/organization/invite-member`, { method: 'POST', headers: new Headers([...viewer, ['content-type', 'application/json']]), body: JSON.stringify({ email: 'other@example.com', role: 'admin', organizationId: workspaceId }) }));
    expect(response.status).toBe(403);
  });
  test('nonmember cannot switch into a workspace', async () => {
    const other = await signIn('other@example.com');
    await expect(auth.api.setActiveOrganization({ headers: other, body: { organizationId: workspaceId } })).rejects.toThrow();
  });
  test('sign out invalidates the session', async () => {
    await auth.api.signOut({ headers: viewer });
    expect(await auth.api.getSession({ headers: viewer })).toBeNull();
  });
});
