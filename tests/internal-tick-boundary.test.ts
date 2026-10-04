import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { createTickRequest, register } from '../instrumentation';
import { apiSessionError } from '@/lib/session';
import { workspaceJob } from '@/lib/workspace-jobs';

vi.unmock('@/lib/session');
vi.unmock('@/lib/workspace-jobs');
const state = vi.hoisted(() => ({ headers: new Headers(), auth: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));
vi.mock('@/lib/auth', () => ({ getAuth: state.auth }));
vi.mock('@/lib/operator-workspace', () => ({ operatorWorkspaceId: () => null }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

test('production-shaped loopback calls pass both auth layers and quietly skip an unbound operator', async () => {
  vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', '1');
  vi.stubEnv('NOSTEROS_BASE_URL', 'https://os.noepenaa.com');
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', ' outer \n');
  vi.stubEnv('NOSTEROS_INTERNAL_SECRET', ' inner \n');
  const work = vi.fn();
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4100\//);
    expect(options.redirect).toBe('error');
    const request = new NextRequest(url, { ...options, signal: options.signal ?? undefined });
    state.headers = request.headers;
    expect(proxy(request).status).toBe(200);
    const route = new URL(url).pathname;
    expect(await apiSessionError(route, 'POST', request)).toBeNull();
    return workspaceJob(route, work);
  });
  vi.stubGlobal('fetch', fetcher);
  const post = createTickRequest('4100');
  for (const route of ['/api/analytics/refresh', '/api/agents/failover', '/api/cron/tick']) {
    expect(await (await post(route))!.json()).toEqual({ ok: true, skipped: 'operator-unavailable', workspaces: [] });
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(work).not.toHaveBeenCalled();
  expect(state.auth).not.toHaveBeenCalled();
});

test('missing internal secret sends no requests and warns only once', async () => {
  vi.stubEnv('NOSTEROS_INTERNAL_SECRET', '');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const post = createTickRequest('4100');
  await post('/api/cron/tick'); await post('/api/agents/failover');
  expect(fetcher).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalledTimes(1);
});

test('authentication rejection stops repeat calls until process restart', async () => {
  vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'inner');
  const fetcher = vi.fn(async () => Response.json({}, { status: 401 })); vi.stubGlobal('fetch', fetcher);
  const post = createTickRequest('4100');
  expect((await post('/api/cron/tick'))?.status).toBe(401);
  expect(await post('/api/cron/tick')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('unbound timer responses produce neither warnings nor false primed messages', async () => {
  vi.useFakeTimers();
  vi.stubEnv('NEXT_RUNTIME', 'nodejs'); vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'inner');
  vi.stubEnv('FOUNDER_OS_SKIP_WARMUP', '0'); vi.stubEnv('FOUNDER_OS_DISABLE_FAILOVER', '0'); vi.stubEnv('FOUNDER_OS_DISABLE_CRON', '0');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, skipped: 'operator-unavailable', workspaces: [] })));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await register(); await vi.advanceTimersByTimeAsync(90_000);
  expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
});
