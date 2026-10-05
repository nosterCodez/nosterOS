import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { NextRequest } from 'next/server';
import { createAuth } from '@/lib/auth';
import { completeEmailSignIn, enterInvitation } from '@/lib/email-entry';
import { invitationEntryURL, verifyInvitationEntry } from '@/lib/invitation-entry';
import { GATE_COOKIE } from '@/lib/auth-constants';
import { proxy } from '../proxy';
import type { SystemMessage } from '@/lib/system-mail';
const baseURL = 'http://localhost:4100', secret = 'fixture-signing-secret-minimum-32-characters';
let db: Database.Database, auth: ReturnType<typeof createAuth>, messages: SystemMessage[], failMail: boolean;
beforeEach(async () => {
  vi.stubEnv('NOSTEROS_SIGNUP_ALLOWLIST', '@example.com');
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', 'fixture-private-beta');
  db = new Database(':memory:'); messages = []; failMail = false;
  auth = createAuth(db, { baseURL, secret, send: async m => { if (failMail) throw new Error('Fixture mail failure'); messages.push(m); } });
  await (await getMigrations(auth.options)).runMigrations();
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
async function signIn(email: string, callbackURL = '/') {
  await auth.api.signInMagicLink({ headers: new Headers({ origin: baseURL }), body: { email, callbackURL } });
  const request = new Request(messages.at(-1)!.url);
  const response = await completeEmailSignIn(request, auth, await auth.handler(request));
  return { request, response, headers: new Headers({ origin: baseURL, cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') }) };
}
async function invite(email = 'teammate@outside.example') {
  const owner = await signIn('owner@example.com');
  const org = (await auth.api.createOrganization({ headers: owner.headers, body: { name: 'Shared work', slug: 'shared', metadata: { kind: 'agency' } } }))!;
  const invitation = await auth.api.createInvitation({ headers: owner.headers, body: { email, role: 'viewer', organizationId: org.id } });
  return { owner, org, invitation, link: messages.at(-1)!.url };
}
function gate(response: Response) { return response.headers.getSetCookie().find(c => c.startsWith(`${GATE_COOKIE}=`)); }

test('new-device email sign-in admits a verified account; replay cannot reuse the request session to admit', async () => {
  const signed = await signIn('owner@example.com');
  expect(gate(signed.response)).toContain('HttpOnly');
  expect(signed.response.headers.get('cache-control')).toBe('no-store');
  expect(signed.response.headers.get('referrer-policy')).toBe('no-referrer');
  expect((await auth.api.getSession({ headers: signed.headers }))?.user.emailVerified).toBe(true);
  const replay = new Request(signed.request.url, { headers: signed.headers });
  expect(gate(await completeEmailSignIn(replay, auth, await auth.handler(replay)))).toBeUndefined();
  expect(gate(await completeEmailSignIn(signed.request, auth, new Response(null, { status: 302, headers: { 'Set-Cookie': 'better-auth.session_token=forged' } })))).toBeUndefined();
});

test('invitation admits through beta, but only verified recipient acceptance grants the assigned workspace role', async () => {
  const { org, invitation, link } = await invite();
  expect(link).not.toContain('fixture-private-beta'); expect(link).not.toContain(secret); expect(link).not.toContain('teammate');
  const entry = await enterInvitation(new Request(link), auth);
  expect(entry.status).toBe(303); expect(gate(entry)).toContain('HttpOnly');
  expect(entry.headers.get('location')).toBe(`${baseURL}/accept-invitation?id=${invitation.id}`);
  expect(db.prepare('SELECT count(*) AS n FROM member').get()).toEqual({ n: 1 });
  const wrong = await signIn('wrong@example.com');
  await expect(auth.api.acceptInvitation({ headers: wrong.headers, body: { invitationId: invitation.id } })).rejects.toThrow();
  const recipient = await signIn('teammate@outside.example', `/accept-invitation?id=${invitation.id}`);
  expect(recipient.response.headers.get('location')).toContain(`/accept-invitation?id=${invitation.id}`);
  db.prepare('UPDATE user SET emailVerified=0 WHERE email=?').run('teammate@outside.example');
  await expect(auth.api.acceptInvitation({ headers: recipient.headers, body: { invitationId: invitation.id } })).rejects.toThrow();
  db.prepare('UPDATE user SET emailVerified=1 WHERE email=?').run('teammate@outside.example');
  await auth.api.acceptInvitation({ headers: recipient.headers, body: { invitationId: invitation.id } });
  expect((await auth.api.getSession({ headers: recipient.headers }))?.session.activeOrganizationId).toBe(org.id);
  expect((await auth.api.getActiveMember({ headers: recipient.headers })).role).toBe('viewer');
  await expect(auth.api.createInvitation({ headers: recipient.headers, body: { email: 'another@example.com', role: 'admin', organizationId: org.id } })).rejects.toThrow();
  expect((await enterInvitation(new Request(link), auth)).status).toBe(400);
  await expect(auth.api.acceptInvitation({ headers: recipient.headers, body: { invitationId: invitation.id } })).rejects.toThrow();
  const nextDevice = await signIn('teammate@outside.example');
  expect((await auth.api.getSession({ headers: nextDevice.headers }))?.session.activeOrganizationId).toBe(org.id);
});

test.each(['canceled', 'expired', 'deleted'] as const)('%s invitation never grants beta admission', async state => {
  const { invitation, link } = await invite();
  if (state === 'deleted') db.prepare('DELETE FROM invitation WHERE id=?').run(invitation.id);
  else if (state === 'expired') db.prepare('UPDATE invitation SET expiresAt=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), invitation.id);
  else db.prepare('UPDATE invitation SET status=? WHERE id=?').run(state, invitation.id);
  const response = await enterInvitation(new Request(link), auth);
  expect(response.status).toBe(400); expect(gate(response)).toBeUndefined();
});

test('signatures reject tampering, expiry, another secret and excessive input', () => {
  const id = 'I'.repeat(32), exp = new Date(Date.now() + 60_000);
  const token = new URL(invitationEntryURL(baseURL, secret, id, exp)).searchParams.get('invite')!;
  expect(verifyInvitationEntry(token, secret)).toEqual({ id, exp: exp.getTime() });
  for (const bad of [token + '.extra', token.slice(0, -1), 'x'.repeat(1025), '']) expect(verifyInvitationEntry(bad, secret)).toBeNull();
  expect(verifyInvitationEntry(token, secret + 'different')).toBeNull();
  expect(verifyInvitationEntry(token, secret, exp.getTime())).toBeNull();
});

test('mail failure can be retried with resend; replaced link becomes invalid', async () => {
  const { owner, org, invitation, link } = await invite();
  // Adapter stores ISO dates. Make the stored invitation older to guarantee a new expiry.
  db.prepare('UPDATE invitation SET expiresAt=? WHERE id=?').run(new Date(Date.now() + 1000).toISOString(), invitation.id);
  failMail = true;
  await expect(auth.api.createInvitation({ headers: owner.headers, body: { email: invitation.email, role: 'viewer', organizationId: org.id, resend: true } })).rejects.toThrow();
  failMail = false;
  await auth.api.createInvitation({ headers: owner.headers, body: { email: invitation.email, role: 'viewer', organizationId: org.id, resend: true } });
  expect((await enterInvitation(new Request(messages.at(-1)!.url), auth)).status).toBe(303);
  expect((await enterInvitation(new Request(link), auth)).status).toBe(400);
});

test('public email entry does not send to unknown unapproved addresses', async () => {
  const response = await auth.api.signInMagicLink({ headers: new Headers({ origin: baseURL }), body: { email: 'unknown@elsewhere.example', callbackURL: '/' } });
  expect(response.status).toBe(true); expect(messages).toEqual([]);
  expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 0 });
});

test('only exact email entry paths bypass beta; data, arbitrary auth actions, methods and connector routes remain gated', () => {
  for (const [method, path] of [['GET', '/sign-in'], ['GET', '/join'], ['GET', '/api/auth/magic-link/verify'], ['POST', '/api/auth/sign-in/magic-link']]) {
    expect(proxy(new NextRequest(baseURL + path, { method })).status, `${method} ${path}`).toBe(200);
  }
  for (const path of ['/api/cloud/stripe', '/api/auth/organization/accept-invitation', '/api/auth/organization/list', '/api/auth/sign-in/magic-link', '/api/auth/magic-link/verify/extra']) {
    expect(proxy(new NextRequest(baseURL + path)).status, path).toBe(401);
  }
  expect(proxy(new NextRequest(baseURL + '/api/auth/magic-link/verify', { method: 'POST' })).status).toBe(401);
  expect(proxy(new NextRequest(baseURL + '/', { headers: { cookie: 'better-auth.session_token=forged' } })).status).toBe(401);
});
