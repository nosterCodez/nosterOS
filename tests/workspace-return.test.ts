import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '@/lib/auth';
import type { SystemMessage } from '@/lib/system-mail';
let db: Database.Database, auth: ReturnType<typeof createAuth>, messages: SystemMessage[];
const baseURL = 'http://localhost:4100';
beforeEach(async () => {
  vi.stubEnv('NOSTEROS_SIGNUP_ALLOWLIST', '@example.com');
  db = new Database(':memory:'); messages = [];
  auth = createAuth(db, { baseURL, secret: 'fixture-only-secret-at-least-32-characters', send: async m => { messages.push(m); } });
  await (await getMigrations(auth.options)).runMigrations();
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
async function signIn(email = 'owner@example.com') {
  await auth.api.signInMagicLink({ headers: new Headers({ origin: baseURL }), body: { email, callbackURL: '/' } });
  const result = await auth.handler(new Request(messages.at(-1)!.url));
  return new Headers({ origin: baseURL, cookie: result.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') });
}
async function create(headers: Headers, slug: string) {
  return (await auth.api.createOrganization({ headers, body: { name: slug, slug, metadata: { kind: 'agency' } } }))!;
}
test('new device and case-insensitive same email restore the existing workspace, not a duplicate', async () => {
  const first = await signIn(), org = await create(first, 'original');
  await auth.api.setActiveOrganization({ headers: first, body: { organizationId: org.id } });
  await auth.api.signOut({ headers: first });
  const second = await signIn('OWNER@example.com');
  expect((await auth.api.getSession({ headers: second }))?.session.activeOrganizationId).toBe(org.id);
  expect((await auth.api.listOrganizations({ headers: second })).map(o => o.id)).toEqual([org.id]);
  expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 1 });
});
test('last explicitly selected membership survives a new session, but revoked membership cannot restore', async () => {
  const first = await signIn(), a = await create(first, 'a'), b = await create(first, 'b');
  await auth.api.setActiveOrganization({ headers: first, body: { organizationId: a.id } });
  expect((await auth.api.getSession({ headers: await signIn() }))?.session.activeOrganizationId).toBe(a.id);
  db.prepare('DELETE FROM member WHERE organizationId=?').run(a.id);
  expect((await auth.api.getSession({ headers: await signIn() }))?.session.activeOrganizationId).toBe(b.id);
});
test('multiple memberships without a preference and a new user do not create or guess a workspace', async () => {
  const first = await signIn();
  expect((await auth.api.getSession({ headers: first }))?.session.activeOrganizationId ?? null).toBeNull();
  await create(first, 'a'); await create(first, 'b');
  db.prepare('DELETE FROM omega_workspace_preferences').run();
  // No historical selection should leak in from another device's session.
  expect((await auth.api.getSession({ headers: await signIn() }))?.session.activeOrganizationId ?? null).toBeNull();
  expect(db.prepare('SELECT count(*) AS n FROM organization').get()).toEqual({ n: 2 });
});
