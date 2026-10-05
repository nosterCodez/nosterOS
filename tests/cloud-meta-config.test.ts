import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { readVaultValue, saveVaultValue } from '@/lib/creds';
import { beginAuthorization, completeAuthorization, disconnectOAuth, providerReady } from '@/lib/cloud-oauth';

let db: ReturnType<typeof openDb>;
const required = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'ads_read'];
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'owner' }, sessionBinding: 'session-a', db });
const start = () => new URL(beginAuthorization(ctx(), 'meta').url);
const permissions = () => ({ data: required.map(permission => ({ permission, status: 'granted' })) });
const exchange = (body: unknown = permissions()) => vi.fn<typeof fetch>()
  .mockResolvedValueOnce(Response.json({ access_token: 'fixture-meta-token', expires_in: 3600 }))
  .mockResolvedValueOnce(Response.json(body));
beforeEach(() => {
  db = openDb(':memory:');
  vi.stubEnv('NOSTEROS_MASTER_KEY', 'ab'.repeat(32));
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_META_CLIENT_ID', '123456789');
  vi.stubEnv('OMEGA_META_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('OMEGA_META_API_VERSION', 'v26.0');
  vi.stubEnv('OMEGA_META_CONFIG_ID', '');
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

test('Meta uses the legacy scope list without a configuration ID', () => {
  const url = start();
  expect(url.origin + url.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
  expect(url.searchParams.get('scope')).toBe(required.join(','));
  expect(url.searchParams.has('config_id')).toBe(false);
  expect(url.searchParams.get('client_id')).toBe('123456789');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4100/api/connections/oauth/meta/callback');
  expect(url.searchParams.get('state')).toBeTruthy();
  expect(url.toString()).not.toContain('fixture-secret');
});

test('Meta config_id replaces scope without changing state, callback or other providers', () => {
  vi.stubEnv('OMEGA_META_CONFIG_ID', '987654321');
  const url = start();
  expect(providerReady('meta')).toBe(true);
  expect(url.searchParams.get('config_id')).toBe('987654321');
  expect(url.searchParams.has('scope')).toBe(false);
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('state')).toBeTruthy();
  expect(url.searchParams.get('redirect_uri')).toContain('/meta/callback');
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'google-fixture');
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'google-secret');
  const google = new URL(beginAuthorization(ctx(), 'google').url);
  expect(google.searchParams.has('config_id')).toBe(false);
  expect(google.searchParams.get('scope')).toContain('webmasters.readonly');
});

test.each(['abc', '12 34', '123&scope=ads_management', ' 123', '123\n', '-12', '1.5', '１２３'])('invalid config ID fails before creating OAuth state: %j', value => {
  vi.stubEnv('OMEGA_META_CONFIG_ID', value);
  expect(providerReady('meta')).toBe(false);
  expect(() => start()).toThrow('setup');
  expect(readVaultValue(ctx(), 'oauth:meta:pending')).toBeUndefined();
});

test.each(['', '987654321'])('both authorization paths verify granted permissions before vault storage (%s)', async config => {
  vi.stubEnv('OMEGA_META_CONFIG_ID', config);
  const state = start().searchParams.get('state')!;
  const fetcher = exchange();
  await completeAuthorization(ctx(), 'meta', 'fixture-code', state, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe('https://graph.facebook.com/v26.0/me/permissions');
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer fixture-meta-token');
  expect(fetcher.mock.calls[1][1]?.method ?? 'GET').toBe('GET');
  expect(JSON.parse(readVaultValue(ctx(), 'oauth:meta:tokens')!).access).toBe('fixture-meta-token');
  expect(JSON.stringify(db.connectionRecords.get('oauth:meta:tokens'))).not.toContain('fixture-meta-token');
  await expect(completeAuthorization(ctx(), 'meta', 'fixture-code', state, fetcher)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each(required)('missing or declined %s fails closed and preserves the existing token', async permission => {
  vi.stubEnv('OMEGA_META_CONFIG_ID', '987654321');
  saveVaultValue(ctx(), 'oauth:meta:tokens', 'previous-envelope-content');
  for (const status of ['missing', 'declined', 'expired']) {
    const body = permissions();
    body.data = body.data.filter(item => item.permission !== permission);
    if (status !== 'missing') body.data.push({ permission, status });
    const state = start().searchParams.get('state')!;
    await expect(completeAuthorization(ctx(), 'meta', 'code', state, exchange(body))).rejects.toThrow('permission');
    expect(readVaultValue(ctx(), 'oauth:meta:tokens')).toBe('previous-envelope-content');
  }
});

test.each([{}, { data: [] }, { data: [{ permission: 'ads_read', status: true }] }])('invalid permission responses cannot authorize a token', async body => {
  const state = start().searchParams.get('state')!;
  await expect(completeAuthorization(ctx(), 'meta', 'code', state, exchange(body))).rejects.toThrow('permission');
  expect(readVaultValue(ctx(), 'oauth:meta:tokens')).toBeUndefined();
});

test('configuration flow retains workspace/session binding and post-request authorization', async () => {
  vi.stubEnv('OMEGA_META_CONFIG_ID', '987654321');
  const state = start().searchParams.get('state')!;
  const fetcher = exchange();
  await expect(completeAuthorization({ ...ctx(), workspace: { id: 'B'.repeat(32) } }, 'meta', 'code', state, fetcher)).rejects.toThrow('permission');
  await expect(completeAuthorization({ ...ctx(), sessionBinding: 'other' }, 'meta', 'code', state, fetcher)).rejects.toThrow('permission');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(completeAuthorization(ctx(), 'meta', 'code', state, fetcher, async () => { throw new Error('membership removed'); })).rejects.toThrow('membership removed');
  expect(readVaultValue(ctx(), 'oauth:meta:tokens')).toBeUndefined();
});

test('disconnect during permission verification prevents token resurrection', async () => {
  const state = start().searchParams.get('state')!;
  const fetcher = exchange();
  fetcher.mockReset().mockResolvedValueOnce(Response.json({ access_token: 'fixture-meta-token', expires_in: 3600 }))
    .mockImplementationOnce(async () => { disconnectOAuth(ctx(), 'meta'); return Response.json(permissions()); });
  await expect(completeAuthorization(ctx(), 'meta', 'code', state, fetcher)).rejects.toThrow('changed');
  expect(readVaultValue(ctx(), 'oauth:meta:tokens')).toBeUndefined();
});
