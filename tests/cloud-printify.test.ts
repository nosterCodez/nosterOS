import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { beginAuthorization, completeAuthorization, accessFor, providerReady, disconnectOAuth } from '@/lib/cloud-oauth';
import { saveVaultValue, readVaultValue } from '@/lib/creds';
import { discoverResources } from '@/lib/cloud-resources';
import { collectCloud } from '@/lib/cloud-adapters';

let db: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'user-a' }, sessionBinding: 'session-a', db });
const expiry = () => new Date(Date.now() + 6 * 3600000).toISOString().replace('T', ' ').replace('.000Z', '+00:00');
const tokens = () => ({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expire_at: expiry() });
function saved(expires = Date.now() + 3600000) { saveVaultValue(ctx(), 'oauth:printify:tokens', JSON.stringify({ access: 'fixture', refresh: 'refresh', expires, generation: 'one' })); }
beforeEach(() => {
  db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_PRINTIFY_APP_ID', 'fixture-app'); vi.stubEnv('OMEGA_PRINTIFY_ENABLED', '1');
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
test('Printify requires approved setup and uses its documented authorization parameters', async () => {
  vi.stubEnv('OMEGA_PRINTIFY_ENABLED', ''); expect(providerReady('printify')).toBe(false);
  vi.stubEnv('OMEGA_PRINTIFY_ENABLED', '1'); expect(providerReady('printify')).toBe(true);
  const url = new URL(beginAuthorization(ctx(), 'printify').url);
  expect(url.origin + url.pathname).toBe('https://printify.com/app/authorize');
  expect(url.searchParams.get('app_id')).toBe('fixture-app');
  const state = url.searchParams.get('state')!;
  expect(new URL(url.searchParams.get('accept_url')!).searchParams.get('state')).toBe(state);
  expect(url.searchParams.has('client_secret')).toBe(false);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(tokens()));
  await completeAuthorization(ctx(), 'printify', 'code', state, fetcher);
  expect(fetcher.mock.calls[0][0]).toBe('https://api.printify.com/v1/app/oauth/tokens');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ app_id: 'fixture-app', code: 'code' });
  expect(await accessFor(ctx(), 'printify', AbortSignal.timeout(1000), fetcher)).toBe('fixture-access');
  await expect(completeAuthorization(ctx(), 'printify', 'code', state, fetcher)).rejects.toThrow();
});
test('Printify refresh rotates tokens and a disconnect invalidates an in-flight refresh', async () => {
  saved(0);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(tokens()));
  expect(await accessFor(ctx(), 'printify', AbortSignal.timeout(1000), fetcher)).toBe('fixture-access');
  expect(fetcher.mock.calls[0][0]).toBe('https://api.printify.com/v1/app/oauth/tokens/refresh');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ app_id: 'fixture-app', refresh_token: 'refresh' });
  saved(0);
  const race = vi.fn<typeof fetch>().mockImplementation(async () => { disconnectOAuth(ctx(), 'printify'); return Response.json(tokens()); });
  await expect(accessFor(ctx(), 'printify', AbortSignal.timeout(1000), race)).rejects.toThrow('changed');
  expect(readVaultValue(ctx(), 'oauth:printify:tokens')).toBeUndefined();
});
test('Printify rejects wrong workspace/session, denied reauthorization and invalid expiration', async () => {
  const state = new URL(beginAuthorization(ctx(), 'printify').url).searchParams.get('state')!;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(tokens()));
  await expect(completeAuthorization({ ...ctx(), sessionBinding: 'other' }, 'printify', 'code', state, fetcher)).rejects.toThrow();
  await expect(completeAuthorization({ ...ctx(), workspace: { id: 'B'.repeat(32) } }, 'printify', 'code', state, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(completeAuthorization(ctx(), 'printify', 'code', state, fetcher, async () => { throw new Error('removed'); })).rejects.toThrow('removed');
  expect(readVaultValue(ctx(), 'oauth:printify:tokens')).toBeUndefined();
  const next = new URL(beginAuthorization(ctx(), 'printify').url).searchParams.get('state')!;
  await expect(completeAuthorization(ctx(), 'printify', 'code', next, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...tokens(), expire_at: 'yesterday' })))).rejects.toThrow();
});
test('Printify discovery strips extra fields and rejects a changed connection', async () => {
  saved(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ id: 123, title: 'Shop', sales_channel: 'etsy', private: 'omit' }]));
  expect(await discoverResources(ctx(), 'printify', fetcher)).toEqual({ resources: [{ id: '123', label: 'Shop' }], truncated: false });
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'User-Agent': 'OmegaOS', Authorization: 'Bearer fixture' });
  const race = vi.fn<typeof fetch>().mockImplementation(async () => { disconnectOAuth(ctx(), 'printify'); return Response.json([]); });
  await expect(discoverResources(ctx(), 'printify', race)).rejects.toThrow('changed');
});
test('Printify totals use provider metadata, preserve zero, omit customer data and never follow paging URLs', async () => {
  saved(); const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ id: 123, title: 'Shop' }]))
    .mockResolvedValueOnce(Response.json({ data: [{ address_to: { email: 'private@example.com' } }], total: 42, next_page_url: 'https://evil.example' }))
    .mockResolvedValueOnce(Response.json({ data: [], total: 0 }))
    .mockResolvedValueOnce(Response.json({ data: [], total: 0 }));
  const options = { now: new Date(), signal: AbortSignal.timeout(5000), fetcher };
  const result = await collectCloud(ctx(), 'printify', '123', options);
  expect(result.values).toEqual({ products: 42, orders: 0, fulfilled: 0 });
  expect(JSON.stringify(result)).not.toContain('private@');
  expect(fetcher.mock.calls.every(([url, init]) => String(url).startsWith('https://api.printify.com/v1/') && (!init?.method || init.method === 'GET'))).toBe(true);
  const wrong = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ id: 456, title: 'Other' }]));
  await expect(collectCloud(ctx(), 'printify', '123', { ...options, fetcher: wrong })).rejects.toThrow('permission');
  expect(wrong).toHaveBeenCalledOnce();
  const missing = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ id: 123, title: 'Shop' }])).mockResolvedValue(Response.json({ data: [] }));
  await expect(collectCloud(ctx(), 'printify', '123', { ...options, fetcher: missing })).rejects.toThrow();
});
