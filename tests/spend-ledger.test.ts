import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openSpendLedger } from '@/lib/spend/ledger';
const a = 'a'.repeat(32), b = 'b'.repeat(32), now = new Date('2026-10-06T12:00:00Z');
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach(clean => clean()));
function fixture(env: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-spend-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, 'spend.db');
  const x = openSpendLedger(filename, env), y = openSpendLedger(filename, env);
  cleanups.push(() => x.close(), () => y.close());
  return { x, y, filename };
}
const request = { feature: 'lead_plan', provider: 'openai', payer: 'byo' as const, pool: 'byo_ai' as const, units: 100, estimatedUsd: 3 };
test('two connections cannot reserve past one workspace cap', async () => {
  const { x, y } = fixture();
  const results = await Promise.all([Promise.resolve().then(() => x.forWorkspace(a).reserve(request, now)), Promise.resolve().then(() => y.forWorkspace(a).reserve(request, now))]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(results.find(r => !r.ok)).toEqual({ ok: false, reason: 'workspace_cap' });
  expect(x.forWorkspace(a).rows('2026-10')).toHaveLength(1);
});
test('two workspaces share the platform cap, but BYO does not consume it', async () => {
  const { x, y } = fixture({ OMEGA_PLATFORM_AI_MONTHLY_USD: '4' });
  x.forWorkspace(a).setCap('platform_ai', 10, { id: 'owner', role: 'owner' });
  y.forWorkspace(b).setCap('platform_ai', 10, { id: 'admin', role: 'admin' });
  expect(x.forWorkspace(a).reserve(request, now).ok).toBe(true);
  const platform = { ...request, payer: 'platform' as const, pool: 'platform_ai' as const };
  const results = await Promise.all([Promise.resolve().then(() => x.forWorkspace(a).reserve(platform, now)), Promise.resolve().then(() => y.forWorkspace(b).reserve(platform, now))]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(results.find(r => !r.ok)).toEqual({ ok: false, reason: 'global_cap' });
});
test('expiry retains the estimate across restart and months are UTC', () => {
  const { x, y } = fixture();
  const result = x.forWorkspace(a).reserve({ ...request, ttlMs: 1 }, now); expect(result.ok).toBe(true);
  expect(y.expire(new Date(now.getTime() + 2))).toBe(1);
  expect(y.forWorkspace(a).rows('2026-10')[0]).toMatchObject({ status: 'expired', actualUsd: 3 });
  expect(y.forWorkspace(a).reserve(request, now).ok).toBe(false);
  expect(y.forWorkspace(a).reserve(request, new Date('2026-11-01T00:00:00Z')).ok).toBe(true);
});
test('settlements are workspace-bound and idempotent, with only known-unbilled release', () => {
  const { x } = fixture(), wa = x.forWorkspace(a), wb = x.forWorkspace(b);
  const first = wa.reserve(request, now); if (!first.ok) throw new Error('fixture');
  expect(wb.commit(first.id, 1, 50, now)).toBe(false);
  expect(wb.release(first.id, 'request_not_sent', now)).toBe(false);
  expect(wb.rows('2026-10')).toEqual([]);
  expect(() => wa.release(first.id, 'timeout' as never, now)).toThrow();
  expect(wa.commit(first.id, 2, 50, now)).toBe(true);
  expect(wa.commit(first.id, 0, 1, now)).toBe(false);
  expect(wa.release(first.id, 'request_not_sent', now)).toBe(false);
  const next = wa.reserve(request, now); if (!next.ok) throw new Error('fixture');
  expect(wa.release(next.id, 'request_not_sent', now)).toBe(true);
  expect(wa.rows('2026-10').map(r => r.status).sort()).toEqual(['committed', 'released']);
});
test('thresholds persist only once per month; cap writes require owner/admin', () => {
  const { x } = fixture(), wa = x.forWorkspace(a);
  expect(() => wa.setCap('byo_ai', 6, { id: 'member', role: 'member' })).toThrow();
  expect(() => wa.setCap('byo_ai', 101, { id: 'owner', role: 'owner' })).toThrow();
  expect(wa.reserve({ ...request, estimatedUsd: 4 }, now).ok).toBe(true);
  expect(wa.reserve({ ...request, estimatedUsd: 1 }, now).ok).toBe(true);
  expect(wa.reserve({ ...request, estimatedUsd: 1 }, now).ok).toBe(false);
  expect(wa.alerts('2026-10').map(r => r.threshold).sort((a, b) => a - b)).toEqual([50, 80, 100]);
});
test('paid pools default closed except BYO AI; invalid globals fail closed', () => {
  const { x } = fixture({ OMEGA_PLATFORM_AI_MONTHLY_USD: 'Infinity' });
  const wa = x.forWorkspace(a);
  expect(wa.reserve({ ...request, pool: 'byo_paid_data', feature: 'email_finder' }, now).ok).toBe(false);
  wa.setCap('platform_ai', 10, { id: 'owner', role: 'owner' });
  expect(wa.reserve({ ...request, pool: 'platform_ai', payer: 'platform' }, now)).toEqual({ ok: false, reason: 'global_cap' });
  expect(() => wa.reserve({ ...request, estimatedUsd: NaN }, now)).toThrow();
  expect(() => wa.reserve({ ...request, estimatedUsd: 0 }, now)).toThrow();
  expect(() => wa.reserve({ ...request, pool: 'platform_ai' }, now)).toThrow();
});
test('free quota uses units across workspaces and providers, not dollar spend', () => {
  const { x } = fixture({ OMEGA_GOOGLE_PLACES_FREE_CALLS: '2' });
  const free = { ...request, pool: 'free_quota' as const, feature: 'places', provider: 'google_places', units: 2, estimatedUsd: 0 };
  expect(x.forWorkspace(a).reserve(free, now).ok).toBe(true);
  expect(x.forWorkspace(b).reserve({ ...free, units: 1 }, now)).toEqual({ ok: false, reason: 'global_cap' });
  expect(x.forWorkspace(b).reserve({ ...free, provider: 'unknown' }, now).ok).toBe(false);
});
