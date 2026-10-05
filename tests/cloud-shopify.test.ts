import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { beginAuthorization, completeAuthorization, accessFor } from '@/lib/cloud-oauth';
import { saveVaultValue, readVaultValue } from '@/lib/creds';
import { discoverResources } from '@/lib/cloud-resources';
import { collectCloud } from '@/lib/cloud-adapters';
import { cloudJson } from '@/lib/cloud-http';
import { shopifyDomain, verifyShopifyCallback } from '@/lib/cloud-shopify';

let db: ReturnType<typeof openDb>;
const shop = 'fixture-shop.myshopify.com';
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'user-a' }, sessionBinding: 'session-a', db });
const response = () => ({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 86399, scope: 'read_orders,read_products' });
function saved() { saveVaultValue(ctx(), 'oauth:shopify:tokens', JSON.stringify({ access: 'fixture', refresh: 'refresh', expires: Date.now() + 3600000, generation: 'one', shop })); }
function callback(state: string, domain = shop) {
  const q = new URLSearchParams({ code: 'code', shop: domain, state, timestamp: String(Math.floor(Date.now() / 1000)) });
  const message = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  q.set('hmac', createHmac('sha256', 'fixture-secret').update(message).digest('hex')); return q;
}
beforeEach(() => {
  db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_SHOPIFY_CLIENT_ID', 'fixture-client'); vi.stubEnv('OMEGA_SHOPIFY_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('OMEGA_SHOPIFY_ENABLED', '1');
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
test('Shopify accepts only canonical store domains and rejects hostile destinations before fetch', async () => {
  expect(shopifyDomain(shop)).toBe(shop);
  const fetcher = vi.fn<typeof fetch>();
  for (const domain of ['evil.example', 'foo.myshopify.com.evil.example', 'foo.bar.myshopify.com', 'https://' + shop, shop + ':443', '-bad.myshopify.com', 'foo@' + shop, 'localhost']) expect(() => shopifyDomain(domain)).toThrow();
  for (const url of ['https://foo.bar.myshopify.com/admin/oauth/access_token', 'https://' + shop + '/evil', 'http://' + shop + '/admin/oauth/access_token']) await expect(cloudJson(url, {}, fetcher)).rejects.toThrow('setup');
  expect(fetcher).not.toHaveBeenCalled();
});
test('Shopify verifies callback HMAC, age and duplicate fields', () => {
  const q = callback('fixture-state'); expect(verifyShopifyCallback(q, 'fixture-secret')).toBe(shop);
  const altered = new URLSearchParams(q); altered.set('code', 'other'); expect(() => verifyShopifyCallback(altered, 'fixture-secret')).toThrow();
  const duplicate = new URLSearchParams(q); duplicate.append('shop', shop); expect(() => verifyShopifyCallback(duplicate, 'fixture-secret')).toThrow();
  expect(() => verifyShopifyCallback(q, 'fixture-secret', Date.now() + 700000)).toThrow();
});
test('Shopify authorization binds domain, exchanges expiring offline tokens and rejects replay', async () => {
  const url = new URL(beginAuthorization(ctx(), 'shopify', Date.now(), shop).url);
  expect(url.origin).toBe('https://' + shop);
  expect(url.searchParams.get('scope')).toBe('read_products,read_orders');
  const state = url.searchParams.get('state')!, fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response()));
  await completeAuthorization(ctx(), 'shopify', 'code', state, fetcher, async () => {}, callback(state));
  expect(fetcher.mock.calls[0][0]).toBe('https://' + shop + '/admin/oauth/access_token');
  expect(new URLSearchParams(String(fetcher.mock.calls[0][1]?.body)).get('expiring')).toBe('1');
  expect(JSON.parse(readVaultValue(ctx(), 'oauth:shopify:tokens')!).shop).toBe(shop);
  await expect(completeAuthorization(ctx(), 'shopify', 'code', state, fetcher, async () => {}, callback(state))).rejects.toThrow();
});
test('Shopify rejects validly signed different shops and missing scopes without saving tokens', async () => {
  let state = new URL(beginAuthorization(ctx(), 'shopify', Date.now(), shop).url).searchParams.get('state')!;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...response(), scope: 'read_products' }));
  await expect(completeAuthorization(ctx(), 'shopify', 'code', state, fetcher, async () => {}, callback(state, 'other.myshopify.com'))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  state = new URL(beginAuthorization(ctx(), 'shopify', Date.now(), shop).url).searchParams.get('state')!;
  await expect(completeAuthorization(ctx(), 'shopify', 'code', state, fetcher, async () => {}, callback(state))).rejects.toThrow();
  expect(readVaultValue(ctx(), 'oauth:shopify:tokens')).toBeUndefined();
});
test('Shopify refresh is sent only to stored shop and rotates the refresh token', async () => {
  saved(); const value = JSON.parse(readVaultValue(ctx(), 'oauth:shopify:tokens')!); value.expires = 0;
  saveVaultValue(ctx(), 'oauth:shopify:tokens', JSON.stringify(value));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response()));
  expect(await accessFor(ctx(), 'shopify', AbortSignal.timeout(1000), fetcher)).toBe('fixture-access');
  expect(fetcher.mock.calls[0][0]).toBe('https://' + shop + '/admin/oauth/access_token');
  expect(JSON.parse(readVaultValue(ctx(), 'oauth:shopify:tokens')!).refresh).toBe('fixture-refresh');
});
test('Shopify GraphQL failures do not turn into zero counts or leak provider messages', async () => {
  saved();
  for (const [body, code] of [
    [{ errors: [{ message: 'private details', extensions: { code: 'ACCESS_DENIED' } }] }, 'permission'],
    [{ errors: [{ extensions: { code: 'THROTTLED' } }] }, 'rate_limit'],
    [{ data: null }, ''],
  ] as const) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(collectCloud(ctx(), 'shopify', shop, { now: new Date(), signal: AbortSignal.timeout(1000), fetcher })).rejects.toThrow(code || undefined);
  }
});
test('Shopify discovers only authorized shop and collects exact aggregate counts, not customer records', async () => {
  saved(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: { shop: { name: 'Fixture shop', myshopifyDomain: shop }, productsCount: { count: 40, precision: 'AT_LEAST' }, ordersCount: { count: 0, precision: 'EXACT' } } }));
  expect(await discoverResources(ctx(), 'shopify', fetcher)).toEqual({ resources: [{ id: shop, label: 'Fixture shop' }], truncated: false });
  const options = { now: new Date('2026-10-05T12:00:00Z'), signal: AbortSignal.timeout(5000), fetcher };
  const result = await collectCloud(ctx(), 'shopify', shop, options);
  expect(result.values).toEqual({ products: null, orders: 0 });
  const body = JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body));
  expect(body.query).not.toMatch(/mutation|customers|email|address/);
  expect(body.variables.ordersQuery).toContain('2026-09-05T12:00:00.000Z');
  const count = fetcher.mock.calls.length;
  await expect(collectCloud(ctx(), 'shopify', 'other.myshopify.com', options)).rejects.toThrow('permission');
  expect(fetcher).toHaveBeenCalledTimes(count);
});
