import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { discoverMetaResources } from '@/lib/cloud-meta';

beforeEach(() => vi.stubEnv('OMEGA_META_API_VERSION', 'v26.0'));
afterEach(() => vi.unstubAllEnvs());
const page = (id: string) => ({ id, name: `Page ${id}`, instagram_business_account: { id: `9${id}`, username: `account${id}` } });

test.each(['facebook', 'instagram', 'meta-ads'])('%s unions personal and portfolio assets, dedupes, and only GETs Graph', async source => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error');
    expect(url.hostname).toBe('graph.facebook.com'); expect(url.searchParams.has('access_token')).toBe(false);
    if (url.pathname.endsWith('/me/businesses')) return Response.json({ data: [{ id: '7' }] });
    if (url.pathname.endsWith('/me/accounts')) return Response.json({ data: [page('1')] });
    if (url.pathname.endsWith('/owned_pages')) return Response.json({ data: [page('1'), page('2')] });
    if (url.pathname.endsWith('/client_pages')) return Response.json({ data: [page('2'), page('3')] });
    if (url.pathname.endsWith('/me/adaccounts')) return Response.json({ data: [{ account_id: '1', name: 'Ads 1' }] });
    if (url.pathname.endsWith('/owned_ad_accounts')) return Response.json({ data: [{ account_id: '1', name: 'Ads 1' }, { account_id: '2', name: 'Ads 2' }] });
    throw new Error('Unexpected endpoint');
  });
  const result = await discoverMetaResources(source, 'fixture-secret', AbortSignal.timeout(5000), fetcher);
  expect(result.resources.map(r => r.id)).toEqual(source === 'facebook' ? ['1', '2', '3'] : source === 'instagram' ? ['91', '92', '93'] : ['1', '2']);
  expect(result.truncated).toBe(false);
  expect(JSON.stringify(result)).not.toContain('fixture-secret');
  expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
});

test('personal Pages still work alone when no businesses exist', async () => {
  const fetcher = vi.fn<typeof fetch>(async input => Response.json({ data: new URL(String(input)).pathname.endsWith('/me/accounts') ? [page('1')] : [] }));
  expect(await discoverMetaResources('facebook', 'fixture', AbortSignal.timeout(5000), fetcher)).toEqual({ resources: [{ id: '1', label: 'Page 1' }], truncated: false });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('at most 10 business portfolios are traversed', async () => {
  const fetcher = vi.fn<typeof fetch>(async input => Response.json({ data: new URL(String(input)).pathname.endsWith('/me/businesses') ? Array.from({ length: 11 }, (_, i) => ({ id: String(i + 1) })) : [] }));
  const result = await discoverMetaResources('facebook', 'fixture', AbortSignal.timeout(5000), fetcher);
  const ids = new Set(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname.split('/')[2]).filter(id => id !== 'me'));
  expect(ids.size).toBe(10); expect(ids.has('11')).toBe(false); expect(result.truncated).toBe(true);
});

test.each(['facebook', 'instagram', 'meta-ads'])('%s caps total source assets at 100 across edges', async source => {
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/me/businesses')) return Response.json({ data: [{ id: '7' }] });
    const personal = path.includes('/me/');
    const count = personal ? 60 : 70, offset = personal ? 1 : 51;
    return Response.json({ data: Array.from({ length: count }, (_, i) => source === 'meta-ads' ? { account_id: String(i + offset), name: 'Ads' } : page(String(i + offset))) });
  });
  const result = await discoverMetaResources(source, 'fixture', AbortSignal.timeout(5000), fetcher);
  expect(result.resources).toHaveLength(100); expect(result.truncated).toBe(true);
});

test('Instagram caps traversed Pages even when none has a professional account', async () => {
  const fetcher = vi.fn<typeof fetch>(async input => Response.json({ data: new URL(String(input)).pathname.endsWith('/me/businesses') ? [{ id: '7' }] : Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), name: 'Page' })) }));
  const result = await discoverMetaResources('instagram', 'fixture', AbortSignal.timeout(5000), fetcher);
  expect(result.resources).toEqual([]); expect(result.truncated).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
