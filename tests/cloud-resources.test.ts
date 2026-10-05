import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { saveVaultValue } from '@/lib/creds';
import { disconnectOAuth } from '@/lib/cloud-oauth';
import { discoverResources } from '@/lib/cloud-resources';
let db: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, db });
beforeEach(() => {
  db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', 'ab'.repeat(32));
  saveVaultValue(ctx(), 'oauth:google:tokens', JSON.stringify({ access: 'private-test-token', expires: Date.now() + 3600000, generation: 'one' }));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
test('returns only verified sites, without leaking tokens or enabling collection', async () => {
  const fetcher = vi.fn(async () => Response.json({ siteEntry: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:unverified.test', permissionLevel: 'siteUnverifiedUser' }] }));
  const result = await discoverResources(ctx(), 'search-console', fetcher);
  expect(result).toEqual({ resources: [{ id: 'https://example.com/', label: 'https://example.com/' }], truncated: false });
  expect(JSON.stringify(result)).not.toContain('private-test-token');
  expect(db.cloudSources.get('search-console')).toBeUndefined();
});
test('lists Analytics properties across bounded pages using fixed host', async () => {
  const urls: string[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    return Response.json({ accountSummaries: [{ propertySummaries: [{ property: `properties/${urls.length}`, displayName: 'Website' }] }], ...(urls.length === 1 ? { nextPageToken: 'https://evil.test/' } : {}) });
  });
  const result = await discoverResources(ctx(), 'ga4', fetcher);
  expect(result.resources.map(r => r.id)).toEqual(['1', '2']);
  expect(urls.every(url => new URL(url).hostname === 'analyticsadmin.googleapis.com')).toBe(true);
  expect(new URL(urls[1]).searchParams.get('pageToken')).toBe('https://evil.test/');
});
test('YouTube only requests owned channels and treats empty accounts honestly', async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request) => Response.json({ items: [] }));
  expect((await discoverResources(ctx(), 'youtube', fetcher)).resources).toEqual([]);
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('mine=true');
});
test('limits pagination and reports truncation', async () => {
  const fetcher = vi.fn(async () => Response.json({ items: [{ id: 'UC' + 'a'.repeat(22), snippet: { title: 'Channel' } }], nextPageToken: 'more' }));
  const result = await discoverResources(ctx(), 'youtube', fetcher);
  expect(fetcher).toHaveBeenCalledTimes(5); expect(result.truncated).toBe(true);
  expect(result.resources).toHaveLength(1);
});
test('fails closed for missing credentials, unsupported services, and malformed payloads', async () => {
  const fetcher = vi.fn(async () => Response.json({ siteEntry: [{ siteUrl: 123 }] }));
  await expect(discoverResources(ctx(), 'stripe', fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(discoverResources(ctx(), 'search-console', fetcher)).rejects.toThrow();
  disconnectOAuth(ctx(), 'google'); fetcher.mockClear();
  await expect(discoverResources(ctx(), 'ga4', fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
test('discards results when account is disconnected during the request', async () => {
  const fetcher = vi.fn(async () => { disconnectOAuth(ctx(), 'google'); return Response.json({ siteEntry: [] }); });
  await expect(discoverResources(ctx(), 'search-console', fetcher)).rejects.toThrow('changed');
});
