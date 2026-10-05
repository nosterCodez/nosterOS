import { z } from 'zod';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import type { CloudSnapshot } from '@/lib/cloud-records';

const Shop = z.object({ id: z.number().int().positive().safe(), title: z.string().min(1).max(500) });
export async function printifyShops(token: string, signal: AbortSignal, fetcher: typeof fetch) {
  const result = await cloudJson('https://api.printify.com/v1/shops.json', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OmegaOS' }, signal }, fetcher);
  const shops = z.array(Shop).max(5000).parse(result);
  return { resources: shops.slice(0, 500).map(shop => ({ id: String(shop.id), label: shop.title })), truncated: shops.length > 500 };
}
export async function collectPrintify(token: string, shop: string, options: { now: Date; signal: AbortSignal; fetcher: typeof fetch }): Promise<CloudSnapshot> {
  if (!/^[1-9]\d{0,15}$/.test(shop)) throw new CloudError('setup');
  const { now, signal, fetcher } = options;
  const shops = await printifyShops(token, signal, fetcher);
  if (!shops.resources.some(s => s.id === shop)) throw new CloudError(shops.truncated ? 'too_large' : 'permission');
  const values: CloudSnapshot['values'] = {};
  for (const [key, path] of [['products', 'products.json?limit=1'], ['orders', 'orders.json?limit=1'], ['fulfilled', 'orders.json?limit=1&status=fulfilled']]) {
    const raw = await cloudJson(`https://api.printify.com/v1/shops/${shop}/${path}`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OmegaOS' }, signal }, fetcher);
    // Pagination metadata supplies the complete total; never sum a limited sample or retain customer fields.
    const page = z.object({ data: z.array(z.unknown()).max(50), total: z.number().int().nonnegative().safe() }).parse(raw);
    if (page.total < page.data.length) throw new CloudError('invalid_data');
    values[key] = page.total;
  }
  return { values, period: 'Current shop totals; all-time orders by status; not revenue', at: now.toISOString() };
}
