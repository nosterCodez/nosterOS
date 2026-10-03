import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth, invitationIsCurrent } from '@/lib/auth';
import type { SystemMessage } from '@/lib/system-mail';

const db = new Database(':memory:');
const messages: SystemMessage[] = [];
const baseURL = 'http://localhost:4100';
const auth = createAuth(db, { baseURL, secret: 'allowlist-test-only-minimum-thirty-two-characters', send: async message => { messages.push(message); } });
beforeAll(async () => {
  await (await getMigrations(auth.options)).runMigrations();
  db.prepare('INSERT INTO organization (id,name,slug,createdAt,metadata) VALUES (?,?,?,?,?)')
    .run('W'.repeat(32), 'Test', 'test', Date.now(), '{"kind":"agency"}');
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
    .run('O'.repeat(32), 'Inviter', 'inviter@example.com', 1, Date.now(), Date.now());
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.close());
async function signup(email: string) {
  await auth.api.signInMagicLink({ headers: new Headers({ origin: baseURL, 'x-forwarded-for': `192.0.2.${messages.length + 1}` }), body: { email, callbackURL: '/' } });
  await auth.handler(new Request(messages.at(-1)!.url, { headers: { 'x-forwarded-for': `192.0.2.${messages.length + 1}` } }));
  return !!db.prepare('SELECT id FROM user WHERE email=?').get(email);
}
test('explicit emails and exact domains can register, case-insensitively', async () => {
  vi.stubEnv('NOSTEROS_SIGNUP_ALLOWLIST', ' ALLOWED@example.com, @TEAM.EXAMPLE ');
  expect(await signup('allowed@example.com')).toBe(true);
  expect(await signup('new@team.example')).toBe(true);
});
test('lookalike domains and other addresses cannot register', async () => {
  vi.stubEnv('NOSTEROS_SIGNUP_ALLOWLIST', '@team.example');
  expect(await signup('outsider@evilteam.example')).toBe(false);
});
test('production without an allowlist rejects new uninvited accounts', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NOSTEROS_SIGNUP_ALLOWLIST', '');
  expect(await signup('uninvited@example.com')).toBe(false);
});
test('a pending unexpired invitation allows registration; expired and revoked invitations do not', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NOSTEROS_SIGNUP_ALLOWLIST', '');
  for (const [email, status, expiry, allowed] of [
    ['invited@example.com', 'pending', Date.now() + 60000, true],
    ['invited-text@example.com', 'pending', new Date(Date.now() + 60000).toISOString(), true],
    ['expired@example.com', 'pending', Date.now() - 60000, false],
    ['expired-text@example.com', 'pending', new Date(Date.now() - 60000).toISOString(), false],
    ['invalid-expiry@example.com', 'pending', 'not-a-date', false],
    ['revoked@example.com', 'canceled', Date.now() + 60000, false],
  ] as const) {
    db.prepare('INSERT INTO invitation (id,organizationId,email,role,status,expiresAt,inviterId,createdAt) VALUES (?,?,?,?,?,?,?,?)')
      .run(email, 'W'.repeat(32), email, 'member', status, expiry, 'O'.repeat(32), Date.now());
    expect(await signup(email), email).toBe(allowed);
  }
});

test('expiry parsing handles actual adapter text and rejects invalid or expired values', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  for (const value of [now + 1000, String(now + 1000), new Date(now + 1000).toISOString()]) expect(invitationIsCurrent(value, now)).toBe(true);
  for (const value of [now, now - 1000, String(now - 1000), new Date(now - 1000).toISOString(), 'not-a-date', null, undefined, '', Infinity]) expect(invitationIsCurrent(value, now)).toBe(false);
});
