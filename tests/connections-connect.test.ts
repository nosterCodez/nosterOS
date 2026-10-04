import { afterEach, expect, test, vi } from 'vitest';
import { POST, DELETE } from '@/app/api/connections/connect/route';
import * as legacy from '@/lib/operator-creds';
import * as keys from '@/lib/keys';
import { POST as adminPost } from '@/app/api/admin/keys/route';
afterEach(() => vi.restoreAllMocks());
test('retired shared key endpoints cannot write, remove or echo credentials', async () => {
  const writes = vi.spyOn(legacy, 'upsertEnvLocal');
  const removes = vi.spyOn(legacy, 'removeEnvLocal');
  const adminWrites = vi.spyOn(keys, 'upsertEnvLocal');
  for (const [method, handler] of [['POST', POST], ['DELETE', DELETE], ['POST', adminPost]] as const) {
    const response = await handler(new Request('http://localhost:4100/api/connections/connect', { method, body: JSON.stringify({ slug: 'fathom', values: { FATHOM_API_KEY: 'private-key-123' }, envVar: 'FATHOM_API_KEY', value: 'private-key-123' }) }));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('private-key-123');
  }
  expect(writes).not.toHaveBeenCalled(); expect(removes).not.toHaveBeenCalled(); expect(adminWrites).not.toHaveBeenCalled();
});
