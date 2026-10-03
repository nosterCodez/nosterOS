import { afterEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
afterEach(() => vi.unstubAllEnvs());
describe('M1 proxy', () => {
  test('anonymous pages redirect and APIs return JSON 401', () => {
    vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', '');
    expect(proxy(new NextRequest('http://localhost:4100/')).headers.get('location')).toContain('/sign-in?next=');
    expect(proxy(new NextRequest('http://localhost:4100/api/agents')).status).toBe(401);
    expect(proxy(new NextRequest('http://localhost:4100/sign-in')).status).toBe(200);
    expect(proxy(new NextRequest('http://localhost:4100/onboarding')).status).toBe(307);
  });
  test('internal header cannot bypass the outer gate or other paths', () => {
    vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', 'outer');
    vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'inner');
    const headers = { 'x-nosteros-internal': 'inner' };
    expect(proxy(new NextRequest('http://localhost:4100/api/cron/tick', { method: 'POST', headers })).status).toBe(401);
    const allowed = { ...headers, cookie: 'founder_os_access=outer' };
    expect(proxy(new NextRequest('http://localhost:4100/api/cron/tick', { method: 'POST', headers: allowed })).status).toBe(200);
    expect(proxy(new NextRequest('http://localhost:4100/api/agents', { method: 'POST', headers: allowed })).status).toBe(401);
    expect(proxy(new NextRequest('http://localhost:4100/api/cron/tick', { method: 'GET', headers: allowed })).status).toBe(401);
  });
  test('caller cannot forge the public layout path', () => {
    vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', '');
    const result = proxy(new NextRequest('http://localhost:4100/agents', { headers: { cookie: 'better-auth.session_token=forged', 'x-nosteros-path': '/sign-in' } }));
    expect(result.headers.get('x-middleware-request-x-nosteros-path')).toBe('/agents');
  });
});
