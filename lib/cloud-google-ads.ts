import { z } from 'zod';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import type { ResourceDiscovery } from '@/lib/cloud-resources';
import type { CloudSnapshot } from '@/lib/cloud-records';

const customerId = z.string().regex(/^\d{10}$/);
const resourceName = z.string().regex(/^customers\/\d{10}$/);
const cursor = z.string().max(4096).optional();
const Roots = z.object({ resourceNames: z.array(resourceName).max(10000).default([]) });
const Clients = z.object({ results: z.array(z.object({ customerClient: z.object({ clientCustomer: resourceName, descriptiveName: z.string().max(500).optional(), manager: z.boolean().optional() }) })).max(10000).default([]), nextPageToken: cursor });
const Account = z.object({ results: z.array(z.object({ customer: z.object({ id: customerId, currencyCode: z.string().regex(/^[A-Z]{3}$/), timeZone: z.string().min(1).max(100), testAccount: z.boolean().optional(), manager: z.boolean().optional() }) })).length(1), nextPageToken: cursor });
const integer = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative().safe());
const decimal = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const Report = z.object({ results: z.array(z.object({ metrics: z.object({ costMicros: integer.optional(), clicks: integer.optional(), impressions: integer.optional(), conversions: decimal.optional() }).optional() })).max(1).default([]), nextPageToken: cursor });

function baseUrl() {
  // Pin the reviewed version, not arbitrary versions or paths supplied through config.
  if (process.env.OMEGA_GOOGLE_ADS_API_VERSION !== 'v25') throw new CloudError('setup');
  return 'https://googleads.googleapis.com/v25';
}
function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new CloudError('invalid_data');
  return result.data;
}
function search(base: string, token: string, customer: string, manager: string, query: string, signal: AbortSignal, fetcher: typeof fetch) {
  return cloudJson(`${base}/customers/${customer}/googleAds:search`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'login-customer-id': manager },
    body: JSON.stringify({ query }), signal,
  }, fetcher);
}

export async function discoverAdsResources(token: string, signal: AbortSignal, fetcher: typeof fetch): Promise<ResourceDiscovery> {
  const base = baseUrl();
  const roots = parse(Roots, await cloudJson(`${base}/customers:listAccessibleCustomers`, { headers: { Authorization: `Bearer ${token}` }, signal }, fetcher));
  const ids = [...new Set(roots.resourceNames.map(r => r.slice('customers/'.length)))];
  const resources = new Map<string, { id: string; label: string }>();
  let truncated = ids.length > 5;
  for (const root of ids.slice(0, 5)) {
    const result = parse(Clients, await search(base, token, root, root, 'SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE LIMIT 501', signal, fetcher));
    truncated ||= Boolean(result.nextPageToken) || result.results.length > 500;
    for (const row of result.results.slice(0, 500)) {
      const client = row.customerClient, id = client.clientCustomer.slice('customers/'.length);
      if (client.manager === true) throw new CloudError('invalid_data');
      if (resources.size >= 500 && !resources.has(id)) { truncated = true; continue; }
      // Prefer direct grants when the same customer is reachable through a manager.
      if (!resources.has(id) || id === root) resources.set(id, { id: id === root ? id : `${root}/${id}`, label: client.descriptiveName || `Account ${id}` });
    }
  }
  return { resources: [...resources.values()], truncated };
}

export async function collectAds(token: string, resource: string, options: { signal: AbortSignal; now: Date; fetcher: typeof fetch }): Promise<CloudSnapshot> {
  if (!/^(\d{10}\/)?\d{10}$/.test(resource)) throw new CloudError('setup');
  const { now, signal, fetcher } = options, base = baseUrl();
  const [first, second] = resource.split('/'), customer = second ?? first;
  const read = (query: string) => search(base, token, customer, first, query, signal, fetcher);
  const account = parse(Account, await read('SELECT customer.id, customer.currency_code, customer.time_zone, customer.test_account, customer.manager FROM customer'));
  if (account.nextPageToken) throw new CloudError('too_large');
  const details = account.results[0].customer;
  if (details.id !== customer || details.manager === true) throw new CloudError('invalid_data');
  let today: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: details.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    today = Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
    if (!Number.isFinite(today)) throw new Error('Invalid date');
  } catch { throw new CloudError('invalid_data'); }
  const date = (days: number) => new Date(today - days * 86400000).toISOString().slice(0, 10);
  const from = date(28), to = date(1);
  const report = parse(Report, await read(`SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}'`));
  if (report.nextPageToken) throw new CloudError('too_large');
  const metrics = report.results[0]?.metrics;
  return {
    at: now.toISOString(), period: `${from} to ${to} (${details.timeZone}); ${details.currencyCode}; spend shown for USD only`,
    ...(details.testAccount === undefined ? {} : { mode: details.testAccount ? 'test' as const : 'live' as const }),
    values: { spend: details.currencyCode === 'USD' && metrics?.costMicros !== undefined ? metrics.costMicros / 1e6 : null, clicks: metrics?.clicks ?? null, impressions: metrics?.impressions ?? null, conversions: metrics?.conversions ?? null },
  };
}
