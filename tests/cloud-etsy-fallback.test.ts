import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { saveVaultValue } from '@/lib/creds';
import { disconnectOAuth } from '@/lib/cloud-oauth';
import { discoverResources } from '@/lib/cloud-resources';

let db: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, db });
const prefix = 'https://api.etsy.com/v3/application';
const denied = () => Response.json({ error: 'No user was provided as part of the bearer token.' }, { status: 403 });
beforeEach(() => {
  db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', 'ab'.repeat(32));
  vi.stubEnv('OMEGA_ETSY_CLIENT_ID', 'fixture-key'); vi.stubEnv('OMEGA_ETSY_CLIENT_SECRET', 'fixture-secret');
  saveVaultValue(ctx(), 'oauth:etsy:tokens', JSON.stringify({ access: '42.fixture-token', generation: 'one', expires: Date.now() + 3600000 }));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

test('403 falls back to authenticated getMe then its single shop, GET only with both headers', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer 42.fixture-token');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-key:fixture-secret');
    if (String(input) === `${prefix}/users/42/shops`) return denied();
    if (String(input) === `${prefix}/users/me`) return Response.json({ user_id: 42, shop_id: 123, email: 'private@fixture.test' });
    expect(String(input)).toBe(`${prefix}/shops/123`);
    return Response.json({ user_id: 42, shop_id: 123, shop_name: 'My shop', extra: 'hidden' });
  });
  expect(await discoverResources(ctx(), 'etsy', fetcher)).toEqual({ resources: [{ id: '123', label: 'My shop' }], truncated: false });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(db.cloudSources.get('etsy')).toBeUndefined();
});

test.each([401, 404, 429, 500])('HTTP %i does not fan out to fallback calls', async status => {
  const fetcher = vi.fn(async () => Response.json({ error: 'denied' }, { status }));
  await expect(discoverResources(ctx(), 'etsy', fetcher)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});

test('getMe failure retains its masked diagnostic, never substitutes an empty shop list', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(denied()).mockResolvedValueOnce(Response.json({ error: 'Scope denied for private@fixture.test 123456789' }, { status: 403 }));
  await expect(discoverResources(ctx(), 'etsy', fetcher)).rejects.toMatchObject({ diagnostic: { httpStatus: 403, message: 'Scope denied for [email] [number]' } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each([
  { user_id: 99, shop_id: 123 }, { user_id: 42, shop_id: '../evil' },
  { user_id: 42, shop_id: Number.MAX_SAFE_INTEGER + 1 }, { user_id: 42 }, { user_id: 42, shop_id: null },
])('invalid/mismatched getMe identity fails closed: %j', async body => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(denied()).mockResolvedValueOnce(Response.json(body));
  await expect(discoverResources(ctx(), 'etsy', fetcher)).rejects.toThrow('invalid_data');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each([{ user_id: 99, shop_id: 123 }, { user_id: 42, shop_id: 456 }])('fallback shop must match both authenticated IDs: %j', async body => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(denied()).mockResolvedValueOnce(Response.json({ user_id: 42, shop_id: 123 })).mockResolvedValueOnce(Response.json({ ...body, shop_name: 'Wrong shop' }));
  await expect(discoverResources(ctx(), 'etsy', fetcher)).rejects.toThrow('invalid_data');
});

test.each([1, 2, 3])('disconnect at fallback step %i invalidates the result', async step => {
  let calls = 0;
  const fetcher = vi.fn<typeof fetch>(async () => {
    calls++; if (calls === step) disconnectOAuth(ctx(), 'etsy');
    return calls === 1 ? denied() : Response.json({ user_id: 42, shop_id: 123, shop_name: 'My shop' });
  });
  await expect(discoverResources(ctx(), 'etsy', fetcher)).rejects.toThrow('changed');
  expect(fetcher).toHaveBeenCalledTimes(step);
});
