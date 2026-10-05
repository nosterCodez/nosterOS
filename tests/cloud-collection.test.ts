import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { saveCredential, saveVaultValue, revokeCredential } from '@/lib/creds';
import { configureSource, sourceView } from '@/lib/cloud-sources';
import { collectCloud } from '@/lib/cloud-adapters';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import { syncSource } from '@/lib/cloud-jobs';
import { accessFor, beginAuthorization, completeAuthorization, disconnectOAuth, oauthGeneration } from '@/lib/cloud-oauth';

let db: ReturnType<typeof openDb>;
const context = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'user-a' }, db });
const now = new Date('2026-10-05T00:00:00Z');
const options = (fetcher: typeof fetch) => ({ now, signal: AbortSignal.timeout(5000), fetcher });
function token(id = 'google', expires = Date.now() + 3600000) { saveVaultValue(context(), `oauth:${id}:tokens`, JSON.stringify({ access: 'private-access-token', refresh: 'private-refresh-token', expires, generation: 'test-generation' })); }
function mockFetch(body: unknown) { return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body)); }
beforeEach(() => { db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex')); vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'client'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'secret'); });
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
test('manual sync collects while paused without enabling scheduled collection and retains cooldown', async () => {
  token(); configureSource(context(), 'ga4', { enabled: false, resource: '123' });
  const collect = vi.fn<typeof collectCloud>().mockResolvedValue({ at: now.toISOString(), period: 'Fixture GA4', values: { users: 7, sessions: 9, keyEvents: 0 } });
  expect(await syncSource(context(), 'ga4', { now, collect })).toMatchObject({ skipped: 'paused' });
  expect(collect).not.toHaveBeenCalled();
  expect(await syncSource(context(), 'ga4', { now, collect, manual: true })).toMatchObject({ ok: true, pointsWritten: 3 });
  expect(sourceView(context(), 'ga4')).toMatchObject({ enabled: false, status: 'paused', snapshot: { values: { users: 7 } } });
  expect(await syncSource(context(), 'ga4', { now, collect, manual: true })).toHaveProperty('skipped');
  expect(await syncSource(context(), 'ga4', { now: new Date(+now + 900001), collect })).toMatchObject({ skipped: 'paused' });
  expect(collect).toHaveBeenCalledOnce();
});

test('paused manual sync cannot publish after a concurrent disconnect or reconfiguration', async () => {
  token(); configureSource(context(), 'ga4', { enabled: false, resource: '123' });
  const collect = vi.fn<typeof collectCloud>().mockImplementation(async () => {
    configureSource(context(), 'ga4', { enabled: false, resource: '456' });
    return { at: now.toISOString(), period: 'Old resource', values: { users: 999 } };
  });
  expect(await syncSource(context(), 'ga4', { now, collect, manual: true })).toMatchObject({ ok: false });
  expect(sourceView(context(), 'ga4').snapshot).toBeNull();
  expect(db.metricPoints.latest('cloud.ga4.users', 'workspace')).toBeNull();
  collect.mockImplementation(async () => { db.cloudSources.invalidate('ga4'); return { at: now.toISOString(), period: 'Disconnected', values: { users: 999 } }; });
  expect(await syncSource(context(), 'ga4', { now: new Date(+now + 900001), collect, manual: true })).toMatchObject({ ok: false });
  expect(sourceView(context(), 'ga4').snapshot).toBeNull();
});
test('Stripe paginates, uses captured amounts, excludes other currency/failed charges and labels test mode', async () => {
  saveCredential(context(), 'STRIPE_SECRET_KEY', 'rk_test_fixture');
  const charge = { id: 'ch_1', amount: 2000, amount_captured: 1000, amount_refunded: 200, paid: true, captured: true, status: 'succeeded', currency: 'usd', livemode: false };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [charge, { ...charge, id: 'ch_2', currency: 'eur' }], has_more: true })).mockResolvedValueOnce(Response.json({ data: [{ ...charge, id: 'ch_3', status: 'failed' }], has_more: false }));
  const result = await collectCloud(context(), 'stripe', '', options(fetcher));
  expect(result).toMatchObject({ mode: 'test', values: { gross: 10, refunded: 2, net: 8, payments: 1 } });
  expect(fetcher.mock.calls[1][0]).toContain('starting_after=ch_2');
  expect(fetcher.mock.calls.every(c => c[1]?.method === 'GET' && c[1]?.redirect === 'error')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('rk_test_fixture');
});
test('Stripe does not accept a partial paginated total, repeated cursors, or mixed test/live data', async () => {
  saveCredential(context(), 'STRIPE_SECRET_KEY', 'rk_test_fixture');
  await expect(collectCloud(context(), 'stripe', '', options(mockFetch({ data: [], has_more: true })))).rejects.toThrow('invalid_data');
  await expect(collectCloud(context(), 'stripe', '', options(mockFetch({ data: [{ id: 'ch', amount_captured: 0, amount_refunded: 0, paid: true, captured: true, status: 'succeeded', currency: 'usd', livemode: true }], has_more: false })))).rejects.toThrow('invalid_data');
});
test('Search Console zero is real zero; empty response is unknown and site URL cannot change API host', async () => {
  token();
  const fetcher = mockFetch({ rows: [{ clicks: 0, impressions: 1, ctr: 0, position: 12.5 }] });
  expect((await collectCloud(context(), 'search-console', 'https://example.com/', options(fetcher))).values).toEqual({ clicks: 0, impressions: 1, ctr: 0, position: 12.5 });
  expect(new URL(String(fetcher.mock.calls[0][0])).hostname).toBe('www.googleapis.com');
  expect((await collectCloud(context(), 'search-console', 'sc-domain:example.com', options(mockFetch({ rows: [] })))).values.clicks).toBeNull();
  await expect(collectCloud(context(), 'ga4', '../../oauth', options(fetcher))).rejects.toThrow('setup');
});
test('GA4 maps response headers rather than assuming position; missing metrics remain unknown', async () => {
  token(); const result = await collectCloud(context(), 'ga4', '123', options(mockFetch({ metricHeaders: [{ name: 'sessions' }, { name: 'activeUsers' }], rows: [{ metricValues: [{ value: '7' }, { value: '0' }] }] })));
  expect(result.values).toEqual({ users: 0, sessions: 7, keyEvents: null });
});
test('YouTube hidden subscribers are not fabricated; Meta non-USD spend is unknown', async () => {
  token(); const channel = 'UC' + 'x'.repeat(22);
  expect((await collectCloud(context(), 'youtube', channel, options(mockFetch({ items: [{ id: channel, statistics: { hiddenSubscriberCount: true, subscriberCount: '99', viewCount: '0', videoCount: '3' } }] })))).values).toEqual({ subscribers: null, views: 0, videos: 3 });
  token('meta'); vi.stubEnv('OMEGA_META_API_VERSION', 'v26.0');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ currency: 'EUR' })).mockResolvedValueOnce(Response.json({ data: [{ spend: '10', impressions: '2', clicks: '0' }] }));
  expect((await collectCloud(context(), 'meta-ads', '123', options(fetcher))).values).toEqual({ spend: null, impressions: 2, clicks: 0 });
});
test('fixed HTTPS destinations only, bounded responses, no redirects, generic errors do not leak tokens', async () => {
  const fetcher = mockFetch({});
  for (const url of ['http://api.stripe.com/v1/charges', 'https://127.0.0.1/', 'https://api.stripe.com.attacker.test/', 'https://user:secret@api.stripe.com/']) await expect(cloudJson(url, {}, fetcher)).rejects.toThrow('setup');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(cloudJson('https://api.stripe.com/v1/charges', {}, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'private-token' }, { status: 401 })))).rejects.toThrow('authentication');
  await expect(cloudJson('https://api.stripe.com/v1/charges', {}, mockFetch({ data: 'x'.repeat(2_000_001) }))).rejects.toThrow('too_large');
});
test('successful points persist, failures preserve last-good snapshot, revocation blocks stale async writes', async () => {
  saveCredential(context(), 'STRIPE_SECRET_KEY', 'rk_test_fixture'); configureSource(context(), 'stripe', { enabled: true, resource: '' });
  const collect = vi.fn<typeof collectCloud>().mockResolvedValue({ at: now.toISOString(), period: 'test', values: { gross: 0, net: 0 } });
  expect(await syncSource(context(), 'stripe', { now, collect })).toMatchObject({ ok: true, pointsWritten: 2 });
  expect(db.metricPoints.latest('cloud.stripe.gross', 'workspace')?.value).toBe(0);
  collect.mockRejectedValue(new Error('sensitive provider body private-token'));
  const failed = await syncSource(context(), 'stripe', { now: new Date(+now + 900001), collect });
  expect(failed.ok).toBe(false); expect(JSON.stringify(failed)).not.toContain('private-token');
  expect(sourceView(context(), 'stripe').snapshot?.values.gross).toBe(0); expect(sourceView(context(), 'stripe').stale).toBe(true);
  collect.mockImplementation(async () => { revokeCredential(context(), 'STRIPE_SECRET_KEY'); return { at: now.toISOString(), period: 'test', values: { gross: 999 } }; });
  expect((await syncSource(context(), 'stripe', { now: new Date(+now + 1800002), collect })).ok).toBe(false);
  expect(db.metricPoints.latest('cloud.stripe.gross', 'workspace')?.value).toBe(0);
  expect(sourceView(context(), 'stripe').snapshot).toBeNull();
});
test('time budgets return without allowing a late collection result to write', async () => {
  saveCredential(context(), 'STRIPE_SECRET_KEY', 'rk_test_fixture'); configureSource(context(), 'stripe', { enabled: true, resource: '' });
  let release!: (r: Awaited<ReturnType<typeof collectCloud>>) => void;
  const collect = vi.fn<typeof collectCloud>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
  expect((await syncSource(context(), 'stripe', { now, collect, budgetMs: 10 })).ok).toBe(false);
  release({ at: now.toISOString(), period: 'late', values: { gross: 999 } }); await Promise.resolve();
  expect(db.metricPoints.latest('cloud.stripe.gross', 'workspace')).toBeNull();
});
test('authorization encrypts token response, never exposes it, refresh respects disconnect races', async () => {
  const start = beginAuthorization(context(), 'google'); const state = new URL(start.url).searchParams.get('state')!;
  const fetcher = mockFetch({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 });
  await completeAuthorization(context(), 'google', 'code', state, fetcher);
  expect(oauthGeneration(context(), 'google')).toBeTruthy(); expect(JSON.stringify(db.connectionRecords.all())).not.toContain('private-access');
  expect(await accessFor(context(), 'google', AbortSignal.timeout(1000), fetcher)).toBe('private-access');
  token('google', 0);
  const race = vi.fn<typeof fetch>().mockImplementation(async () => { disconnectOAuth(context(), 'google'); return Response.json({ access_token: 'late-token', expires_in: 3600 }); });
  await expect(accessFor(context(), 'google', AbortSignal.timeout(1000), race)).rejects.toThrow('changed');
  expect(oauthGeneration(context(), 'google')).toBe('');
});
test('pending OAuth cannot reconnect after a concurrent disconnect or permission loss', async () => {
  const state = new URL(beginAuthorization(context(), 'google').url).searchParams.get('state')!;
  const race = vi.fn<typeof fetch>().mockImplementation(async () => { disconnectOAuth(context(), 'google'); return Response.json({ access_token: 'late-token', expires_in: 3600 }); });
  await expect(completeAuthorization(context(), 'google', 'code', state, race)).rejects.toThrow('changed');
  const next = new URL(beginAuthorization(context(), 'google').url).searchParams.get('state')!;
  await expect(completeAuthorization(context(), 'google', 'code', next, mockFetch({ access_token: 'private', expires_in: 3600 }), async () => { throw new CloudError('permission'); })).rejects.toThrow();
  expect(oauthGeneration(context(), 'google')).toBe('');
});
