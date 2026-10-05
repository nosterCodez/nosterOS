import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

const path = '/tiktoklSWY4Ex56HH0QDQpspaNshAY0mtHg4MS.txt';
afterEach(() => vi.unstubAllEnvs());

test('TikTok ownership proof is public for GET and HEAD only', () => {
  vi.stubEnv('NOSTEROS_ACCESS_TOKEN', 'private-beta');
  for (const method of ['GET', 'HEAD']) {
    expect(proxy(new NextRequest(`https://os.noepenaa.com${path}`, { method })).headers.get('x-middleware-next')).toBe('1');
  }
  for (const blocked of [path + '/extra', '/tiktok-other.txt', '/api/agents', '/', '/integrations']) {
    expect(proxy(new NextRequest(`https://os.noepenaa.com${blocked}`)).status).toBe(401);
  }
  expect(proxy(new NextRequest(`https://os.noepenaa.com${path}`, { method: 'POST' })).status).toBe(401);
  expect(readFileSync(`public${path}`, 'utf8').trim()).toBe('tiktok-developers-site-verification=lSWY4Ex56HH0QDQpspaNshAY0mtHg4MS');
});
