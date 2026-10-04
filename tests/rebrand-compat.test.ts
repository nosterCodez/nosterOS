import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { accessToken, databaseOverride } from '@/lib/legacy-env';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
test('new environment names take precedence; fallback warns once without values', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(accessToken({ NOSTEROS_ACCESS_TOKEN: 'new', FOUNDER_OS_ACCESS_TOKEN: 'old' })).toBe('new');
  expect(databaseOverride({ NOSTEROS_DB: '/new', FOUNDER_OS_DB: '/old' })).toBe('/new');
  expect(warn).not.toHaveBeenCalled();
  expect(accessToken({ FOUNDER_OS_ACCESS_TOKEN: 'private-value' })).toBe('private-value');
  expect(accessToken({ FOUNDER_OS_ACCESS_TOKEN: 'private-value' })).toBe('private-value');
  expect(databaseOverride({ FOUNDER_OS_DB: '/private-path' })).toBe('/private-path');
  expect(databaseOverride({ FOUNDER_OS_DB: '/private-path' })).toBe('/private-path');
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls.flat().join(' ')).not.toMatch(/private-value|private-path/);
});
test('old beta cookie is reissued and expired without redirecting an internal POST', () => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', 'outer');
  vi.stubEnv('NOSTEROS_INTERNAL_SECRET', 'inner');
  const response = proxy(new NextRequest('https://os.noepenaa.com/api/cron/tick', { method: 'POST', headers: { cookie: 'founder_os_access=outer', 'x-nosteros-internal': 'inner' } }));
  expect(response.status).toBe(200);
  expect(response.headers.get('location')).toBeNull();
  expect(response.cookies.get('nosteros_access')?.value).toBe('outer');
  expect(response.cookies.get('founder_os_access')?.value).toBe('');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
});
test('new cookie works after removing legacy variable, while stale tokens fail', () => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', 'new'); vi.stubEnv('FOUNDER_OS_ACCESS_TOKEN', undefined);
  expect(proxy(new NextRequest('https://os.noepenaa.com/sign-in', { headers: { cookie: 'nosteros_access=new' } })).status).toBe(200);
  expect(proxy(new NextRequest('https://os.noepenaa.com/sign-in', { headers: { cookie: 'founder_os_access=old' } })).status).toBe(401);
});
