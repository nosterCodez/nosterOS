import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createBackupTick } from '@/lib/backup/schedule';
import { createTickRequest } from '../instrumentation';
const state = vi.hoisted(() => ({ run: vi.fn(), store: vi.fn() }));
vi.mock('@/lib/backup/run', () => ({ runBackup: state.run }));
vi.mock('@/lib/backup/store', () => ({ configuredStore: state.store }));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const env = { DATA_DIR: '/fixture/data', OMEGA_ENV: 'staging', OMEGA_BACKUP_KEY: Buffer.alloc(32, 5).toString('base64'),
  RAILWAY_GIT_COMMIT_SHA: 'abcdef12', OMEGA_BACKUP_S3_ENDPOINT: 'https://example.com', OMEGA_BACKUP_S3_BUCKET: 'fixture',
  OMEGA_BACKUP_S3_ACCESS_KEY_ID: 'fixture-id', OMEGA_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret', OMEGA_BACKUP_S3_REGION: 'fixture' };
test('missing configuration skips without crashing and emits one fixed warning per UTC day', async () => {
  const warn = vi.fn(), tick = createBackupTick(warn);
  await tick({}, new Date('2026-10-05T08:00:00Z')); await tick({}, new Date('2026-10-05T09:00:00Z'));
  expect(warn).toHaveBeenCalledTimes(1); expect(state.run).not.toHaveBeenCalled();
  await tick({}, new Date('2026-10-06T08:00:00Z')); expect(warn).toHaveBeenCalledTimes(2);
});
test('schedule starts at 08 UTC, uses environment namespace, and contains failures', async () => {
  const warn = vi.fn(), tick = createBackupTick(warn);
  await tick(env, new Date('2026-10-05T07:59:59Z')); expect(state.run).not.toHaveBeenCalled();
  state.run.mockResolvedValueOnce({ status: 'success' });
  await tick(env, new Date('2026-10-05T08:00:00Z'));
  expect(state.store).toHaveBeenCalledWith(env, 'staging');
  expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ root: env.DATA_DIR, appCommit: 'abcdef12' }));
  state.run.mockRejectedValueOnce(new Error('credential fixture-secret'));
  await expect(tick(env, new Date('2026-10-05T09:00:00Z'))).resolves.toMatchObject({ status: 'failed' });
  expect(JSON.stringify(warn.mock.calls)).not.toContain('fixture-secret');
});
test('backup tick is behind the cron route auth boundary and internal-secret check', () => {
  const source = readFileSync('app/api/cron/tick/route.ts', 'utf8');
  expect(source.indexOf('if (authError) return authError;', source.indexOf('export async function POST'))).toBeLessThan(source.indexOf('await runBackupTick('));
  expect(source).toMatch(/if \(internal\) await runBackupTick\(\)/);
});
test('cron self-call allows backup verification time without lengthening other tick timeouts', async () => {
  vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'fixture');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const post = createTickRequest('4100');
  await post('/api/cron/tick'); expect(timeout).toHaveBeenLastCalledWith(120_000);
  await post('/api/analytics/refresh'); expect(timeout).toHaveBeenLastCalledWith(20_000);
});
