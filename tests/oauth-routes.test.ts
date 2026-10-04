import { afterEach, expect, test, vi } from 'vitest';
import { GET as start } from '@/app/api/oauth/[provider]/start/route';
import { GET as callback } from '@/app/api/oauth/callback/route';
import * as store from '@/lib/oauth/store';
afterEach(() => vi.restoreAllMocks());
test('legacy OAuth cannot redirect, exchange tokens or store shared credentials', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const save = vi.spyOn(store, 'saveTokens');
  for (const provider of ['google', 'github', 'not-a-provider']) {
    const response = await start(new Request('http://localhost/api/oauth/' + provider + '/start'), { params: Promise.resolve({ provider }) });
    expect(response.status).toBe(409); expect(response.headers.get('location')).toBeNull();
  }
  for (const query of ['', '?code=abc&state=forged.signature', '?error_description=private-provider-message']) {
    const response = await callback(new Request('http://localhost/api/oauth/callback' + query));
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('private-provider-message');
  }
  expect(fetcher).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
