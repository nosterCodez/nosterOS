import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { connectionMetadata, saveCredential, saveVaultValue } from '@/lib/creds';
import { verifyCredential, verifyDueCredentials } from '@/lib/credential-verification';
import { verificationState } from '@/lib/verification-state';
import { configureSource, credentialVersion, sourceView } from '@/lib/cloud-sources';
import { syncSource } from '@/lib/cloud-jobs';
import { EMAIL_FIELDS } from '@/lib/verification-types';

const imap = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('imapflow', () => ({ ImapFlow: class { on() {} close() {} connect = imap.connect; } }));
let dbs: ReturnType<typeof openDb>[];
const ctx = (i = 0) => ({ workspace: { id: (i ? 'B' : 'A').repeat(32) }, db: dbs[i] });
beforeEach(() => { vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex')); dbs = [openDb(':memory:'), openDb(':memory:')]; imap.connect.mockResolvedValue(undefined); });
afterEach(() => { dbs.forEach(db => db.close()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
test('legacy keys become unverified without modifying ciphertext; partial email is incomplete', () => {
  saveCredential(ctx(), 'OPENAI_API_KEY', 'fixture'); saveCredential(ctx(), 'INBOX_1_HOST', 'imap.gmail.com');
  const before = dbs[0].connectionRecords.all();
  expect(verificationState(ctx(), 'OPENAI_API_KEY').status).toBe('unverified');
  expect(verificationState(ctx(), 'email').status).toBe('incomplete');
  expect(dbs[0].connectionRecords.all()).toEqual(before);
});
test.each(['stripe', 'printify', 'email'])('%s verification never changes generation or collector configuration', async provider => {
  const name = provider === 'stripe' ? 'STRIPE_SECRET_KEY' : provider === 'printify' ? 'PRINTIFY_API_TOKEN' : 'email';
  if (provider === 'email') ['imap.gmail.com', 'fixture@example.test', 'secret'].forEach((value, i) => saveCredential(ctx(), EMAIL_FIELDS[i], value));
  else saveCredential(ctx(), name, provider === 'stripe' ? 'rk_test_fixture' : 'fixture');
  configureSource(ctx(), provider, { resource: provider === 'printify' ? '123' : '', enabled: true });
  const generation = credentialVersion(ctx(), provider), configuration = dbs[0].cloudSources.get(provider), records = dbs[0].connectionRecords.all();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  await verifyCredential(ctx(), name);
  expect(credentialVersion(ctx(), provider)).toBe(generation); expect(dbs[0].cloudSources.get(provider)).toEqual(configuration); expect(dbs[0].connectionRecords.all()).toEqual(records);
  expect(verificationState(ctx(), name)).toMatchObject({ status: 'verified', checkedAt: expect.any(String), verifiedAt: expect.any(String) });
});
test('daily checks are workspace-local, once per day, with no repeated collector retries after rejection', async () => {
  for (let i = 0; i < 2; i++) { saveCredential(ctx(i), 'STRIPE_SECRET_KEY', `rk_test_workspace${i}`); configureSource(ctx(i), 'stripe', { resource: '', enabled: true }); }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Response(null, { status: new Headers(init?.headers).get('authorization')!.endsWith('0') ? 401 : 200 }));
  vi.stubGlobal('fetch', fetcher);
  const now = Date.now(); await verifyDueCredentials(ctx(), { now }); await verifyDueCredentials(ctx(1), { now });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(sourceView(ctx(), 'stripe')).toMatchObject({ enabled: false, status: 'error' }); expect(sourceView(ctx(1), 'stripe').enabled).toBe(true);
  const collect = vi.fn(); expect(await syncSource(ctx(), 'stripe', { manual: true, collect })).toHaveProperty('skipped'); expect(collect).not.toHaveBeenCalled();
  await verifyDueCredentials(ctx(), { now: now + 3600000 }); expect(fetcher).toHaveBeenCalledTimes(2);
  await verifyDueCredentials(ctx(), { now: now + 86400000 }); expect(fetcher).toHaveBeenCalledTimes(3);
  expect(connectionMetadata(ctx(1)).find(c => c.name === 'STRIPE_SECRET_KEY')?.status).toBe('verified');
});
test('email has one daily check; incomplete configurations make no network request', async () => {
  ['imap.gmail.com', 'fixture@example.test', 'secret'].forEach((value, i) => saveCredential(ctx(), EMAIL_FIELDS[i], value));
  saveCredential(ctx(1), 'INBOX_1_HOST', 'imap.gmail.com');
  imap.connect.mockClear();
  await verifyDueCredentials(ctx()); await verifyDueCredentials(ctx()); await verifyDueCredentials(ctx(1));
  expect(imap.connect).toHaveBeenCalledOnce();
});
test('late rejection cannot pause a replacement key or replace its metadata', async () => {
  saveCredential(ctx(), 'STRIPE_SECRET_KEY', 'rk_test_old'); configureSource(ctx(), 'stripe', { resource: '', enabled: true });
  vi.stubGlobal('fetch', vi.fn(async () => { saveCredential(ctx(), 'STRIPE_SECRET_KEY', 'rk_test_new'); configureSource(ctx(), 'stripe', { resource: '', enabled: true }); return new Response(null, { status: 401 }); }));
  await expect(verifyCredential(ctx(), 'STRIPE_SECRET_KEY')).rejects.toThrow('Connection changed');
  expect(sourceView(ctx(), 'stripe')).toMatchObject({ enabled: true, status: 'ready' }); expect(verificationState(ctx(), 'STRIPE_SECRET_KEY').status).toBe('unverified');
});
test('failed fallback PAT verification does not pause active Printify OAuth', async () => {
  saveCredential(ctx(), 'PRINTIFY_API_TOKEN', 'fixture');
  saveVaultValue(ctx(), 'oauth:printify:tokens', JSON.stringify({ access: 'oauth', generation: 'oauth-one', expires: Date.now() + 3600000 }));
  configureSource(ctx(), 'printify', { resource: '123', enabled: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
  await verifyCredential(ctx(), 'PRINTIFY_API_TOKEN'); expect(sourceView(ctx(), 'printify')).toMatchObject({ enabled: true, connectionMethod: 'Printify sign-in', status: 'ready' });
});
test('manual rate window is persisted per workspace and expires after one minute', () => {
  for (let i = 0; i < 5; i++) expect(dbs[0].connectionVerifications.takeManual(1000)).toBe(true);
  expect(dbs[0].connectionVerifications.takeManual(1001)).toBe(false); expect(dbs[1].connectionVerifications.takeManual(1001)).toBe(true);
  expect(dbs[0].connectionVerifications.takeManual(61000)).toBe(true);
});
test('a cancelled daily probe records unreachable rather than retaining a stale verified label', async () => {
  saveCredential(ctx(), 'OPENAI_API_KEY', 'fixture');
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(() => { controller.abort(); return new Promise<Response>(() => {}); }));
  await verifyDueCredentials(ctx(), { signal: controller.signal });
  expect(verificationState(ctx(), 'OPENAI_API_KEY').status).toBe('unreachable');
});
test('legacy unsupported mailbox host becomes incomplete without blocking later daily checks', async () => {
  ['unsupported.example', 'fixture@example.test', 'secret'].forEach((value, i) => saveCredential(ctx(), EMAIL_FIELDS[i], value));
  const before = imap.connect.mock.calls.length;
  await verifyDueCredentials(ctx()); expect(verificationState(ctx(), 'email').status).toBe('incomplete');
  saveCredential(ctx(), 'OPENAI_API_KEY', 'fixture'); vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  await verifyDueCredentials(ctx()); expect(verificationState(ctx(), 'OPENAI_API_KEY').status).toBe('verified');
  expect(imap.connect.mock.calls.length).toBe(before);
});

test.each(['stripe', 'printify', 'email'])('verified %s replacement preserves saved resource, auto-read and snapshot', async provider => {
  const name = provider === 'stripe' ? 'STRIPE_SECRET_KEY' : provider === 'printify' ? 'PRINTIFY_API_TOKEN' : 'email';
  if (provider === 'email') ['imap.gmail.com', 'fixture@example.test', 'old-secret'].forEach((value, i) => saveCredential(ctx(), EMAIL_FIELDS[i], value));
  else saveCredential(ctx(), name, provider === 'stripe' ? 'rk_test_old' : 'old-fixture');
  const resource = provider === 'printify' ? '123' : '';
  configureSource(ctx(), provider, { resource, enabled: true });
  const before = dbs[0].cloudSources.get(provider)!;
  const snapshot = { at: new Date().toISOString(), period: 'Fixture', values: { fixture: 2 } };
  dbs[0].cloudSources.claim(provider, before.revision, 'claim', 1000);
  dbs[0].cloudSources.finish(provider, before.revision, 'claim', snapshot, 'old-error');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  await verifyCredential(ctx(), name, provider === 'email' ? { email: { host: 'imap.gmail.com', account: 'replacement@example.test', password: 'new-secret' } } : { value: provider === 'stripe' ? 'rk_test_new' : 'new-fixture' });
  const after = dbs[0].cloudSources.get(provider)!;
  expect(after).toMatchObject({ resource, enabled: true, snapshot, error: null, credentialVersion: credentialVersion(ctx(), provider) });
  expect(after.credentialVersion).not.toBe(before.credentialVersion); expect(after.revision).not.toBe(before.revision);
  expect(sourceView(ctx(), provider).status).not.toBe('needs_setup');
  expect(dbs[1].cloudSources.get(provider)).toBeUndefined();
});

test('saving a verified fallback Printify token does not revise the active OAuth source', async () => {
  saveVaultValue(ctx(), 'oauth:printify:tokens', JSON.stringify({ access: 'oauth', generation: 'oauth-one', expires: Date.now() + 3600000 }));
  configureSource(ctx(), 'printify', { resource: '123', enabled: true });
  const before = dbs[0].cloudSources.get('printify');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  await verifyCredential(ctx(), 'PRINTIFY_API_TOKEN', { value: 'fixture' });
  expect(dbs[0].cloudSources.get('printify')).toEqual(before);
});
