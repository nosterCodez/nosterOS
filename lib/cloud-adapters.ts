import { z } from 'zod';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import { accessFor, etsyAppHeaders } from '@/lib/cloud-oauth';
import { resolveCred, type VaultContext } from '@/lib/creds';
import { cloudSource } from '@/lib/cloud-catalog';
import type { CloudSnapshot } from '@/lib/cloud-records';
import { collectAds } from '@/lib/cloud-google-ads';

const numeric = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const obj = z.record(z.string(), z.unknown());
const date = (days: number, now: Date) => new Date(+now - days * 86400_000).toISOString().slice(0, 10);
type Options = { signal: AbortSignal; now: Date; fetcher?: typeof fetch };
export async function collectCloud(ctx: VaultContext, id: string, resource: string, options: Options): Promise<CloudSnapshot> {
  const { now, signal, fetcher = fetch } = options;
  const source = cloudSource(id);
  if (source.planned || (source.resourcePattern && !new RegExp(source.resourcePattern).test(resource))) throw new CloudError('setup');
  const token = source.provider ? await accessFor(ctx, source.provider, signal, fetcher) : id === 'stripe' ? resolveCred(ctx, 'STRIPE_SECRET_KEY') : undefined;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const read = (url: string, body?: unknown, additional?: Record<string, string>) => cloudJson(url, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}), ...additional }, ...(body ? { body: JSON.stringify(body) } : {}), signal }, fetcher);
  const snapshot = (values: CloudSnapshot['values'], period: string, mode?: 'test' | 'live'): CloudSnapshot => ({ values, period, at: now.toISOString(), ...(mode ? { mode } : {}) });
  switch (id) {
    case 'google-ads': return collectAds(token!, resource, { now, signal, fetcher });
    case 'search-console': {
      const from = date(30, now), to = date(3, now);
      const body = z.object({ rows: z.array(z.object({ clicks: numeric, impressions: numeric, ctr: numeric, position: numeric })).max(1).optional() }).parse(await read(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(resource)}/searchAnalytics/query`, { startDate: from, endDate: to, dataState: 'final', aggregationType: 'byProperty' }));
      const r = body.rows?.[0];
      return snapshot(r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr * 100, position: r.position } : { clicks: null, impressions: null, ctr: null, position: null }, `${from} to ${to} (Search Console PT)`);
    }
    case 'ga4': {
      const from = date(28, now), to = date(1, now);
      const body = z.object({ kind: z.string().optional(), rowCount: z.number().int().nonnegative().optional(), metricHeaders: z.array(z.object({ name: z.string() })).optional(), rows: z.array(z.object({ metricValues: z.array(z.object({ value: numeric })) })).max(1).optional() }).refine(report => Boolean(report.metricHeaders?.length) || (report.kind === 'analyticsData#runReport' && !report.rows?.length && !report.rowCount), 'Unrecognized or incomplete Analytics report').parse(await read(`https://analyticsdata.googleapis.com/v1beta/properties/${resource}:runReport`, { dateRanges: [{ startDate: from, endDate: to }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'keyEvents' }] }));
      const values: CloudSnapshot['values'] = { users: null, sessions: null, keyEvents: null };
      for (const [index, header] of (body.metricHeaders ?? []).entries()) { const key = header.name === 'activeUsers' ? 'users' : header.name; if (key in values) values[key] = body.rows?.[0]?.metricValues[index]?.value ?? null; }
      return snapshot(values, `${from} to ${to} (property timezone)`);
    }
    case 'google-business': {
      const from = date(30, now), to = date(3, now), query = new URLSearchParams();
      const mappings = { CALL_CLICKS: 'calls', WEBSITE_CLICKS: 'website', BUSINESS_DIRECTION_REQUESTS: 'directions' };
      for (const key of Object.keys(mappings)) query.append('dailyMetrics', key);
      for (const [part, value] of [['startDate', from], ['endDate', to]]) { const [year, month, day] = value.split('-'); query.set(`dailyRange.${part}.year`, year); query.set(`dailyRange.${part}.month`, String(Number(month))); query.set(`dailyRange.${part}.day`, String(Number(day))); }
      const calendarDate = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) });
      const daily = z.object({ dailyMetric: z.string(), timeSeries: z.object({ datedValues: z.array(z.object({ date: calendarDate.optional(), value: numeric.optional() })).max(366).optional() }) });
      const result = z.object({ multiDailyMetricTimeSeries: z.array(z.object({ dailyMetricTimeSeries: z.array(daily) })).optional() }).parse(await read(`https://businessprofileperformance.googleapis.com/v1/locations/${resource}:fetchMultiDailyMetricsTimeSeries?${query}`));
      const values: CloudSnapshot['values'] = { calls: null, website: null, directions: null };
      const expected = new Set(Array.from({ length: 28 }, (_, index) => date(30 - index, now)));
      const series = (result.multiDailyMetricTimeSeries ?? []).flatMap(s => s.dailyMetricTimeSeries);
      for (const [metric, key] of Object.entries(mappings)) {
        const matching = series.filter(s => s.dailyMetric === metric);
        if (matching.length !== 1) continue;
        const days = matching[0].timeSeries.datedValues;
        if (!days || days.length !== expected.size) continue;
        const seen = new Set<string>(); let sum = 0, complete = true;
        for (const d of days) {
          const day = d.date && `${d.date.year}-${String(d.date.month).padStart(2, '0')}-${String(d.date.day).padStart(2, '0')}`;
          if (!day || !expected.has(day) || seen.has(day) || d.value === undefined) { complete = false; break; }
          seen.add(day); sum += d.value;
        }
        if (complete && Number.isSafeInteger(sum)) values[key] = sum;
      }
      return snapshot(values, `${from} to ${to} (location timezone)`);
    }
    case 'stripe': {
      if (!token || !/^rk_(test|live)_/.test(token)) throw new CloudError('setup');
      const mode = token.startsWith('rk_test_') ? 'test' : 'live';
      const charge = z.object({ id: z.string(), amount_captured: numeric, amount_refunded: numeric, paid: z.boolean(), captured: z.boolean(), status: z.string(), currency: z.string(), livemode: z.boolean() });
      let after = '', gross = 0, refunded = 0, payments = 0;
      for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ limit: '100', 'created[gte]': String(Math.floor(+now / 1000) - 30 * 86400), 'created[lt]': String(Math.floor(+now / 1000)), ...(after ? { starting_after: after } : {}) });
        const list = z.object({ data: z.array(charge), has_more: z.boolean() }).parse(await read(`https://api.stripe.com/v1/charges?${query}`, undefined, { 'Stripe-Version': '2026-08-26.dahlia' }));
        for (const c of list.data) {
          if (c.livemode !== (mode === 'live')) throw new CloudError('invalid_data');
          if (c.currency === 'usd' && c.paid && c.captured && c.status === 'succeeded') { gross += c.amount_captured; refunded += c.amount_refunded; payments++; }
        }
        if (!list.has_more) return snapshot({ gross: gross / 100, refunded: refunded / 100, net: (gross - refunded) / 100, payments }, 'Rolling 30 days; USD only; refunds on these charges', mode);
        const next = list.data.at(-1)?.id; if (!next || next === after) throw new CloudError('invalid_data'); after = next;
      }
      throw new CloudError('too_large');
    }
    case 'youtube': {
      const result = z.object({ items: z.array(z.object({ id: z.string(), statistics: z.object({ subscriberCount: numeric.optional(), hiddenSubscriberCount: z.boolean().optional(), viewCount: numeric.optional(), videoCount: numeric.optional() }) })) }).parse(await read(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(resource)}`));
      const r = result.items.find(i => i.id === resource)?.statistics; if (!r) throw new CloudError('permission');
      return snapshot({ subscribers: r.hiddenSubscriberCount ? null : r.subscriberCount ?? null, views: r.viewCount ?? null, videos: r.videoCount ?? null }, 'Channel lifetime totals');
    }
    case 'facebook': case 'instagram': case 'meta-ads': {
      const version = process.env.OMEGA_META_API_VERSION; if (!/^v\d+\.0$/.test(version ?? '')) throw new CloudError('setup');
      const base = `https://graph.facebook.com/${version}`;
      if (id === 'meta-ads') {
        const from = date(28, now), to = date(1, now);
        const account = z.object({ currency: z.string() }).parse(await read(`${base}/act_${resource}?fields=currency`));
        const query = new URLSearchParams({ fields: 'spend,impressions,clicks', time_range: JSON.stringify({ since: from, until: to }), level: 'account' });
        const result = z.object({ data: z.array(z.object({ spend: numeric.optional(), impressions: numeric.optional(), clicks: numeric.optional() })).max(1) }).parse(await read(`${base}/act_${resource}/insights?${query}`));
        const r = result.data[0]; return snapshot({ spend: account.currency === 'USD' ? r?.spend ?? null : null, impressions: r?.impressions ?? null, clicks: r?.clicks ?? null }, `${from} to ${to}; account currency ${account.currency}`);
      }
      const result = obj.parse(await read(`${base}/${resource}?fields=${id === 'facebook' ? 'followers_count,fan_count' : 'followers_count,media_count'}`));
      const value = (key: string) => result[key] === undefined ? null : numeric.parse(result[key]);
      return snapshot(id === 'facebook' ? { followers: value('followers_count'), likes: value('fan_count') } : { followers: value('followers_count'), media: value('media_count') }, 'Current account totals');
    }
    case 'tiktok': {
      const result = z.object({ data: z.object({ user: z.object({ follower_count: numeric.optional(), likes_count: numeric.optional(), video_count: numeric.optional() }) }), error: z.object({ code: z.string() }).optional() }).parse(await read('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count'));
      if (result.error && result.error.code !== 'ok') throw new CloudError('permission');
      return snapshot({ followers: result.data.user.follower_count ?? null, likes: result.data.user.likes_count ?? null, videos: result.data.user.video_count ?? null }, 'Current authorized account totals');
    }
    case 'etsy': {
      const result = z.object({ shop_id: numeric, transaction_sold_count: numeric.optional(), listing_active_count: numeric.optional() }).parse(await read(`https://api.etsy.com/v3/application/shops/${resource}`, undefined, etsyAppHeaders()));
      if (String(result.shop_id) !== resource) throw new CloudError('invalid_data');
      return snapshot({ sales: result.transaction_sold_count ?? null, listings: result.listing_active_count ?? null }, 'Shop lifetime sales and current active listings');
    }
    case 'linkedin': {
      const version = process.env.OMEGA_LINKEDIN_API_VERSION; if (!/^\d{6}$/.test(version ?? '')) throw new CloudError('setup');
      const result = z.object({ firstDegreeSize: numeric }).parse(await read(`https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(`urn:li:organization:${resource}`)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, undefined, { 'LinkedIn-Version': version!, 'X-Restli-Protocol-Version': '2.0.0' }));
      return snapshot({ followers: result.firstDegreeSize }, 'Organization follower total');
    }
    case 'email': return collectInbox(ctx, signal, now);
    default: throw new CloudError('setup');
  }
}
export const IMAP_HOSTS = ['imap.gmail.com', 'outlook.office365.com', 'imap.mail.yahoo.com', 'imap.mail.me.com', 'imap.fastmail.com'];
async function collectInbox(ctx: VaultContext, signal: AbortSignal, now: Date): Promise<CloudSnapshot> {
  const host = resolveCred(ctx, 'INBOX_1_HOST')?.toLowerCase(), user = resolveCred(ctx, 'INBOX_1_USER'), pass = resolveCred(ctx, 'INBOX_1_PASS');
  if (!host || !IMAP_HOSTS.includes(host) || !user || !pass) throw new CloudError('setup');
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false, connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 8000, tls: { rejectUnauthorized: true } });
  client.on('error', () => {});
  const abort = () => client.close(); signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted(); await client.connect(); signal.throwIfAborted();
    const result = await client.status('INBOX', { messages: true, unseen: true });
    signal.throwIfAborted(); if (!result) throw new CloudError('invalid_data');
    return { at: now.toISOString(), period: 'Current INBOX counts; no message content', values: { messages: result.messages ?? null, unread: result.unseen ?? null } };
  } catch (e) { if (e instanceof CloudError) throw e; throw new CloudError(signal.aborted ? 'timeout' : 'permission'); }
  finally { signal.removeEventListener('abort', abort); client.close(); }
}
