import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { beginAuthorization, consumeAuthorization } from '@/lib/cloud-oauth';
import { configureSource, sourceView } from '@/lib/cloud-sources';
import { saveCredential } from '@/lib/creds';

let a: ReturnType<typeof openDb>, b: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'user-a' }, db: a });
beforeEach(() => {
  a = openDb(':memory:'); b = openDb(':memory:');
  vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'test-client'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'test-secret');
});
afterEach(() => { a.close(); b.close(); vi.unstubAllEnvs(); });
test('OAuth state has no verifier, binds user/workspace/provider, expires and is single use', () => {
  const start = beginAuthorization(ctx(), 'google');
  const state = new URL(start.url).searchParams.get('state')!;
  expect(state).not.toContain('test-secret');
  expect(() => consumeAuthorization({ ...ctx(), user: { id: 'other' } }, 'google', state)).toThrow();
  expect(() => consumeAuthorization({ ...ctx(), workspace: { id: 'B'.repeat(32) }, db: b }, 'google', state)).toThrow();
  expect(() => consumeAuthorization(ctx(), 'google-business', state)).toThrow();
  expect(() => consumeAuthorization(ctx(), 'google', state + 'x')).toThrow();
  expect(consumeAuthorization(ctx(), 'google', state).verifier.length).toBeGreaterThan(40);
  expect(() => consumeAuthorization(ctx(), 'google', state)).toThrow();
  const expired = new URL(beginAuthorization(ctx(), 'google', Date.now() - 700_000).url).searchParams.get('state')!;
  expect(() => consumeAuthorization(ctx(), 'google', expired)).toThrow();
  const bound = { ...ctx(), sessionBinding: 'session-one' };
  const sessionState = new URL(beginAuthorization(bound, 'google').url).searchParams.get('state')!;
  expect(() => consumeAuthorization({ ...bound, sessionBinding: 'session-two' }, 'google', sessionState)).toThrow();
  expect(() => consumeAuthorization(bound, 'google', sessionState, Date.now() - 60000)).toThrow();
  expect(consumeAuthorization(bound, 'google', sessionState).verifier).toBeTruthy();
});
test('new source has unknown data, never zero; credentials and snapshots are workspace scoped', () => {
  saveCredential(ctx(), 'STRIPE_SECRET_KEY', 'rk_test_test-only');
  configureSource(ctx(), 'stripe', { resource: '', enabled: true });
  const view = sourceView(ctx(), 'stripe');
  expect(view.snapshot).toBeNull(); expect(view.status).toBe('ready');
  expect(sourceView({ workspace: { id: 'B'.repeat(32) }, db: b }, 'stripe').status).toBe('not_connected');
});
test('source changes invalidate snapshot and pending claims without removing old history', () => {
  configureSource(ctx(), 'ga4', { resource: '12345', enabled: true });
  const first = a.cloudSources.get('ga4')!;
  expect(a.cloudSources.claim('ga4', first.revision, 'claim', Date.now())).toBe(true);
  expect(a.cloudSources.claim('ga4', first.revision, 'other', Date.now())).toBe(false);
  configureSource(ctx(), 'ga4', { resource: '67890', enabled: true });
  expect(a.cloudSources.finish('ga4', first.revision, 'claim', { at: new Date().toISOString(), period: 'test', values: { users: 0 } }, null)).toBe(false);
  expect(a.cloudSources.get('ga4')!.snapshot).toBeNull();
});
