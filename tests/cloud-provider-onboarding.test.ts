import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { saveVaultValue } from '@/lib/creds';
import { beginAuthorization, completeAuthorization, disconnectOAuth, providerReady } from '@/lib/cloud-oauth';
import { discoverResources } from '@/lib/cloud-resources';
import { collectCloud } from '@/lib/cloud-adapters';

let db: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'owner' }, db });
function token(provider: string, access = 'private-test-token') {
  saveVaultValue(ctx(), `oauth:${provider}:tokens`, JSON.stringify({ access, expires: Date.now() + 3600000, generation: provider }));
}
beforeEach(() => {
  db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', 'ab'.repeat(32));
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'fixture'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('OMEGA_GOOGLE_BUSINESS_ENABLED', '');
  vi.stubEnv('OMEGA_ETSY_CLIENT_ID', 'fixture-etsy'); vi.stubEnv('OMEGA_ETSY_CLIENT_SECRET', 'fixture-secret');
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

test('Business Profile requires explicit platform readiness and never broadens base Google scopes', () => {
  expect(providerReady('google-business')).toBe(false);
  expect(() => beginAuthorization(ctx(), 'google-business')).toThrow('setup');
  vi.stubEnv('OMEGA_GOOGLE_BUSINESS_ENABLED', '1');
  expect(providerReady('google-business')).toBe(true);
  const url = new URL(beginAuthorization(ctx(), 'google-business').url);
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/business.manage');
  expect(url.searchParams.get('redirect_uri')).toContain('/google-business/callback');
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
  expect(new URL(beginAuthorization(ctx(), 'google').url).searchParams.get('scope')).not.toContain('business.manage');
});

test('Business Profile selection uses bounded fixed-host location reads and no address data', async () => {
  token('google-business'); const urls: URL[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(new URL(String(url)));
    expect(init?.method ?? 'GET').toBe('GET');
    return Response.json({ locations: [{ name: 'locations/123', title: 'My business', storefrontAddress: 'not-returned' }], ...(urls.length === 1 ? { nextPageToken: 'https://evil.test/' } : {}) });
  });
  expect(await discoverResources(ctx(), 'google-business', fetcher)).toEqual({ resources: [{ id: '123', label: 'My business' }], truncated: false });
  expect(urls).toHaveLength(2);
  expect(urls.every(u => u.hostname === 'mybusinessbusinessinformation.googleapis.com' && u.pathname === '/v1/accounts/-/locations')).toBe(true);
  expect(urls[0].searchParams.get('readMask')).toBe('name,title');
  expect(urls[1].searchParams.get('pageToken')).toBe('https://evil.test/');
  expect(db.cloudSources.get('google-business')).toBeUndefined();
});

test('Business Profile selection rejects malformed IDs, truncates and checks its own token generation', async () => {
  token('google-business'); token('google');
  const fetcher = vi.fn(async () => Response.json({ locations: [], nextPageToken: 'more' }));
  expect((await discoverResources(ctx(), 'google-business', fetcher)).truncated).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(5);
  await expect(discoverResources(ctx(), 'google-business', async () => Response.json({ locations: [{ name: 'locations/../../me', title: 'Bad' }] }))).rejects.toThrow('invalid_data');
  await expect(discoverResources(ctx(), 'google-business', async () => { disconnectOAuth(ctx(), 'google'); return Response.json({}); })).resolves.toEqual({ resources: [], truncated: false });
  await expect(discoverResources(ctx(), 'google-business', async () => { disconnectOAuth(ctx(), 'google-business'); return Response.json({}); })).rejects.toThrow('changed');
});

test('Etsy discovers only the authorized owner shop and never returns private response fields', async () => {
  token('etsy', '42.private-etsy-token');
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://api.etsy.com/v3/application/users/42/shops');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-etsy:fixture-secret');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer 42.private-etsy-token');
    return Response.json({ shop_id: 123, user_id: 42, shop_name: 'Shop', private_data: 'hidden' });
  });
  expect(await discoverResources(ctx(), 'etsy', fetcher)).toEqual({ resources: [{ id: '123', label: 'Shop' }], truncated: false });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(db.cloudSources.get('etsy')).toBeUndefined();
});

test('Etsy rejects invalid token prefixes, mismatched owners, unsafe integers and disconnect races', async () => {
  const fetcher = vi.fn(async () => Response.json({ shop_id: 123, user_id: 42, shop_name: 'Shop' }));
  token('etsy', '../private');
  await expect(discoverResources(ctx(), 'etsy', fetcher)).rejects.toThrow('invalid_data'); expect(fetcher).not.toHaveBeenCalled();
  token('etsy', '42.private');
  await expect(discoverResources(ctx(), 'etsy', async () => Response.json({ shop_id: 123, user_id: 99, shop_name: 'Other' }))).rejects.toThrow('invalid_data');
  await expect(discoverResources(ctx(), 'etsy', async () => Response.json({ shop_id: Number.MAX_SAFE_INTEGER + 1, user_id: 42, shop_name: 'Bad' }))).rejects.toThrow('invalid_data');
  await expect(discoverResources(ctx(), 'etsy', async () => { disconnectOAuth(ctx(), 'etsy'); return Response.json({ shop_id: 123, user_id: 42, shop_name: 'Shop' }); })).rejects.toThrow('changed');
});

test('Etsy token exchange supplies the app header while retaining PKCE and narrow scopes', async () => {
  const url = new URL(beginAuthorization(ctx(), 'etsy').url);
  expect(url.searchParams.get('scope')).toBe('shops_r');
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-etsy:fixture-secret');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('code_verifier')).toBeTruthy(); expect(body.has('client_secret')).toBe(false);
    return Response.json({ access_token: '42.private', refresh_token: '42.refresh', expires_in: 3600 });
  });
  await completeAuthorization(ctx(), 'etsy', 'fixture-code', url.searchParams.get('state')!, fetcher);
});

test('new discovery paths do not fall back to another workspace or base Google authorization', async () => {
  token('google'); const fetcher = vi.fn();
  for (const id of ['google-business', 'etsy']) await expect(discoverResources(ctx(), id, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

test('Business Profile reports complete totals only; missing days or values stay unknown', async () => {
  token('google-business');
  const now = new Date('2026-10-05T12:00:00Z');
  const days = Array.from({ length: 28 }, (_, index) => {
    const d = new Date(+now - (30 - index) * 86400000);
    return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, value: '0' };
  });
  const result = await collectCloud(ctx(), 'google-business', '123', { now, signal: AbortSignal.timeout(3000), fetcher: async () => Response.json({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
    { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: days } },
    { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: days.slice(1) } },
    { dailyMetric: 'BUSINESS_DIRECTION_REQUESTS', timeSeries: { datedValues: days.map((d, i) => i ? d : { date: d.date }) } },
  ] }] }) });
  expect(result.values).toEqual({ calls: 0, website: null, directions: null });
});
