import { afterEach, describe, expect, test, vi } from 'vitest';
import { internalRequestHeaders, register } from '../instrumentation';
import { GATE_COOKIE } from '@/lib/access-gate';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('internal request authentication', () => {
  test('supplies the internal header and optional outer-gate cookie', () => {
    expect(internalRequestHeaders('test123', 'outer')).toEqual({ 'x-nosteros-internal': 'test123', Cookie: `${GATE_COOKIE}=outer` });
    expect(internalRequestHeaders('test123', '')).toEqual({ 'x-nosteros-internal': 'test123' });
    expect(internalRequestHeaders(undefined, '')).toEqual({});
    expect(internalRequestHeaders('', '')).toEqual({});
  });

  test('every internal fetch is authenticated and failed ticks warn before parsing', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', 'test123');
    vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'internal123');
    vi.stubEnv('FOUNDER_OS_SKIP_WARMUP', '0');
    vi.stubEnv('FOUNDER_OS_DISABLE_FAILOVER', '0');
    vi.stubEnv('FOUNDER_OS_DISABLE_CRON', '0');
    const json = vi.fn().mockRejectedValue(new Error('must not parse HTML'));
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401, json });
    vi.stubGlobal('fetch', fetcher);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await register();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, options] of fetcher.mock.calls) {
      expect(options.headers).toEqual({ 'x-nosteros-internal': 'internal123', Cookie: `${GATE_COOKIE}=test123` });
    }
    expect(json).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[cron] tick failed: HTTP 401');
    expect(warn).toHaveBeenCalledWith('[failover] tick failed: HTTP 401');
  });

  test('Railway without a Meta key never reports connected', async () => {
    vi.resetModules();
    vi.stubEnv('DEMO_GATE', undefined);
    vi.stubEnv('RAILWAY_ENVIRONMENT', 'production');
    vi.doMock('@/lib/operator-creds', () => ({ resolveCred: () => undefined, CRED_FILES: {} }));
    const { metaAdsStatus } = await import('@/lib/connectors/meta-ads');
    expect((await metaAdsStatus()).state).toBe('not_configured');
    vi.doUnmock('@/lib/operator-creds');
  });
});
