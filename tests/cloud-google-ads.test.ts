import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { saveVaultValue } from '@/lib/creds';
import { beginAuthorization, disconnectOAuth, providerReady } from '@/lib/cloud-oauth';
import { discoverResources } from '@/lib/cloud-resources';
import { collectCloud } from '@/lib/cloud-adapters';
import { cloudJson, CLOUD_ERROR_TEXT } from '@/lib/cloud-http';

let db: ReturnType<typeof openDb>;
const manager = '1111111111', customer = '2222222222';
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'owner' }, db });
const now = new Date('2026-10-05T01:00:00Z');
function token(provider = 'google-ads') {
  saveVaultValue(ctx(), `oauth:${provider}:tokens`, JSON.stringify({ access: 'private-ads-token', expires: Date.now() + 3600000, generation: provider }));
}
beforeEach(() => {
  db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', 'ab'.repeat(32));
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'fixture'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('OMEGA_GOOGLE_ADS_ENABLED', ''); vi.stubEnv('OMEGA_GOOGLE_ADS_API_VERSION', 'v25');
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

test('Ads remains gated and uses its own OAuth scope, callback and token slot', async () => {
  expect(providerReady('google-ads')).toBe(false);
  expect(() => beginAuthorization(ctx(), 'google-ads')).toThrow('setup');
  vi.stubEnv('OMEGA_GOOGLE_ADS_ENABLED', '1');
  const url = new URL(beginAuthorization(ctx(), 'google-ads').url);
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
  expect(url.searchParams.get('redirect_uri')).toContain('/google-ads/callback');
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
  expect(new URL(beginAuthorization(ctx(), 'google').url).searchParams.get('scope')).not.toContain('adwords');
  token('google'); const fetcher = vi.fn();
  await expect(discoverResources(ctx(), 'google-ads', fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv('OMEGA_GOOGLE_ADS_API_VERSION', '../evil'); expect(providerReady('google-ads')).toBe(false);
});

test('Ads discovers owned and manager-accessible customers with workspace-local mapping', async () => {
  token(); const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('customers:listAccessibleCustomers')) return Response.json({ resourceNames: [`customers/${manager}`, `customers/${customer}`] });
    return Response.json({ results: [{ customerClient: { clientCustomer: `customers/${customer}`, descriptiveName: 'Store', manager: false } }] });
  });
  const result = await discoverResources(ctx(), 'google-ads', fetcher);
  expect(result).toEqual({ resources: [{ id: customer, label: 'Store' }], truncated: false });
  expect(requests).toHaveLength(3);
  expect(new Headers(requests[1].init?.headers).get('login-customer-id')).toBe(manager);
  expect(requests.every(r => new URL(r.url).hostname === 'googleads.googleapis.com')).toBe(true);
  expect(requests[1].url).toContain('googleAds:search');
  expect(JSON.parse(String(requests[1].init?.body)).query).toContain('customer_client.manager = FALSE');
  expect(JSON.stringify(result)).not.toContain('private-ads-token'); expect(db.cloudSources.get('google-ads')).toBeUndefined();
});

test('Ads discovery bounds queries and does not follow provider URLs', async () => {
  token(); const urls: string[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    if (urls.length === 1) return Response.json({ resourceNames: Array.from({ length: 8 }, (_, i) => `customers/${1111111111 + i}`) });
    return Response.json({ results: [], nextPageToken: 'https://evil.test/private-token' });
  });
  expect((await discoverResources(ctx(), 'google-ads', fetcher)).truncated).toBe(true);
  expect(urls).toHaveLength(6); expect(urls.every(u => new URL(u).hostname === 'googleads.googleapis.com')).toBe(true);
  await expect(discoverResources(ctx(), 'google-ads', async () => Response.json({ resourceNames: ['customers/../evil'] }))).rejects.toThrow('invalid_data');
});

test('Ads discovery invalidates disconnects and never uses another provider generation', async () => {
  token(); token('google');
  await expect(discoverResources(ctx(), 'google-ads', async () => { disconnectOAuth(ctx(), 'google'); return Response.json({ resourceNames: [] }); })).resolves.toEqual({ resources: [], truncated: false });
  await expect(discoverResources(ctx(), 'google-ads', async () => { disconnectOAuth(ctx(), 'google-ads'); return Response.json({ resourceNames: [] }); })).rejects.toThrow('changed');
});

function reporting(currencyCode = 'USD', metrics: unknown = { costMicros: '1250000', clicks: '0', impressions: '100', conversions: 1.5 }) {
  const requests: { url: string; body: { query: string }; headers: Headers }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return Response.json(requests.length === 1 ? { results: [{ customer: { id: customer, currencyCode, timeZone: 'America/Los_Angeles', testAccount: true, manager: false } }] } : { results: metrics ? [{ metrics }] : [] });
  });
  return { fetcher, requests };
}

test('Ads reads account-local dates and preserves USD amount, real zero and test labels', async () => {
  token(); const { fetcher, requests } = reporting();
  const result = await collectCloud(ctx(), 'google-ads', `${manager}/${customer}`, { now, signal: AbortSignal.timeout(3000), fetcher });
  expect(result.values).toEqual({ spend: 1.25, clicks: 0, impressions: 100, conversions: 1.5 });
  expect(result.mode).toBe('test'); expect(result.period).toContain('2026-09-06 to 2026-10-03');
  expect(requests).toHaveLength(2); expect(requests[1].body.query).toContain("BETWEEN '2026-09-06' AND '2026-10-03'");
  expect(requests.every(r => r.url.endsWith(`/customers/${customer}/googleAds:search`) && r.headers.get('login-customer-id') === manager)).toBe(true);
  expect(requests.every(r => !r.headers.has('developer-token'))).toBe(true);
});

test('Ads never converts other currencies or substitutes zero for missing metrics', async () => {
  token();
  const options = { now, signal: AbortSignal.timeout(3000) };
  expect((await collectCloud(ctx(), 'google-ads', customer, { ...options, fetcher: reporting('EUR', { costMicros: '1000000' }).fetcher })).values).toEqual({ spend: null, clicks: null, impressions: null, conversions: null });
  expect((await collectCloud(ctx(), 'google-ads', customer, { ...options, fetcher: reporting('USD', null).fetcher })).values).toEqual({ spend: null, clicks: null, impressions: null, conversions: null });
});

test('Ads rejects mismatched customers, malformed selectors, invalid timezones and partial reports', async () => {
  token(); const options = { now, signal: AbortSignal.timeout(3000) };
  const fetcher = vi.fn();
  await expect(collectCloud(ctx(), 'google-ads', '../evil', { ...options, fetcher })).rejects.toThrow('setup'); expect(fetcher).not.toHaveBeenCalled();
  for (const data of [{ id: manager, timeZone: 'UTC' }, { id: customer, timeZone: 'invalid' }]) {
    await expect(collectCloud(ctx(), 'google-ads', customer, { ...options, fetcher: async () => Response.json({ results: [{ customer: { ...data, currencyCode: 'USD' } }] }) })).rejects.toThrow('invalid_data');
  }
  let count = 0;
  await expect(collectCloud(ctx(), 'google-ads', customer, { ...options, fetcher: async () => Response.json(++count === 1 ? { results: [{ customer: { id: customer, timeZone: 'UTC', currencyCode: 'USD' } }] } : { results: [], nextPageToken: 'more' }) })).rejects.toThrow('too_large');
});

test('Ads project approval error is actionable without leaking provider messages', async () => {
  const response = () => Response.json({ error: { message: 'private-provider-message', details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure', errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }] } }, { status: 403 });
  await expect(cloudJson('https://googleads.googleapis.com/v25/customers:listAccessibleCustomers', {}, async () => response())).rejects.toThrow('platform_approval');
  expect(CLOUD_ERROR_TEXT.platform_approval).toContain('approval'); expect(JSON.stringify(CLOUD_ERROR_TEXT)).not.toContain('private-provider-message');
});
