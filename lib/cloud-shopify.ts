import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import type { CloudSnapshot } from '@/lib/cloud-records';

export const SHOPIFY_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
export function shopifyDomain(value: string) {
  if (!SHOPIFY_DOMAIN.test(value)) throw new CloudError('setup');
  return value;
}
export function verifyShopifyCallback(params: URLSearchParams, secret: string | undefined, now = Date.now()) {
  if (!secret || params.toString().length > 16000) throw new CloudError('setup');
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new CloudError('permission');
  const hmac = params.get('hmac') ?? '', timestamp = params.get('timestamp') ?? '';
  if (!/^[a-f0-9]{64}$/.test(hmac) || !/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 600000) throw new CloudError('permission');
  const message = [...params.entries()].filter(([key]) => key !== 'hmac').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('&');
  const expected = createHmac('sha256', secret).update(message).digest();
  if (!timingSafeEqual(expected, Buffer.from(hmac, 'hex'))) throw new CloudError('permission');
  return shopifyDomain(params.get('shop') ?? '');
}
const Shop = z.object({ name: z.string().min(1).max(500), myshopifyDomain: z.string().regex(SHOPIFY_DOMAIN) });
const Count = z.object({ count: z.number().int().nonnegative().safe(), precision: z.enum(['EXACT', 'AT_LEAST']) }).nullable();
async function queryShopify(token: string, shop: string, query: string, variables: object, signal: AbortSignal, fetcher: typeof fetch) {
  const raw = await cloudJson(`https://${shopifyDomain(shop)}/admin/api/2026-10/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables }), signal }, fetcher);
  const envelope = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ extensions: z.object({ code: z.string().optional() }).optional() })).optional() }).parse(raw);
  if (envelope.errors?.length) {
    const codes = envelope.errors.map(e => e.extensions?.code);
    throw new CloudError(codes.includes('THROTTLED') ? 'rate_limit' : codes.includes('ACCESS_DENIED') ? 'permission' : 'provider');
  }
  return envelope.data;
}
export async function shopifyResource(token: string, shop: string, signal: AbortSignal, fetcher: typeof fetch) {
  const data = z.object({ shop: Shop }).parse(await queryShopify(token, shop, 'query OmegaShop { shop { name myshopifyDomain } }', {}, signal, fetcher));
  if (data.shop.myshopifyDomain !== shop) throw new CloudError('permission');
  return { resources: [{ id: shop, label: data.shop.name }], truncated: false };
}
export async function collectShopify(token: string, shop: string, options: { now: Date; signal: AbortSignal; fetcher: typeof fetch }): Promise<CloudSnapshot> {
  const { now, signal, fetcher } = options;
  const from = new Date(+now - 30 * 86400000).toISOString(), to = now.toISOString();
  const query = 'query OmegaCounts($ordersQuery: String!) { shop { name myshopifyDomain } productsCount { count precision } ordersCount(query: $ordersQuery) { count precision } }';
  const data = z.object({ shop: Shop, productsCount: Count, ordersCount: Count }).parse(await queryShopify(token, shop, query, { ordersQuery: `created_at:>=${from} created_at:<${to}` }, signal, fetcher));
  if (data.shop.myshopifyDomain !== shop) throw new CloudError('permission');
  return { at: to, period: `Products now; orders created ${from} to ${to} (UTC); not revenue; approximate counts omitted`, values: { products: data.productsCount?.precision === 'EXACT' ? data.productsCount.count : null, orders: data.ordersCount?.precision === 'EXACT' ? data.ordersCount.count : null } };
}
