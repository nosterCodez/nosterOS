import { afterEach, expect, test, vi } from 'vitest';
import path from 'node:path';
import { storeDir } from '@/lib/foreplay/store';

afterEach(() => vi.unstubAllEnvs());
test('ad storage follows DATA_DIR and retains the explicit override', () => {
  vi.stubEnv('ADSCOUT_STORE_DIR', undefined);
  vi.stubEnv('DATA_DIR', path.join(process.cwd(), 'test-volume'));
  expect(storeDir()).toBe(path.join(process.cwd(), 'test-volume', 'ad-intel'));
  vi.stubEnv('ADSCOUT_STORE_DIR', path.join(process.cwd(), 'override'));
  expect(storeDir()).toBe(path.join(process.cwd(), 'override'));
});
test('local default remains cwd/data/ad-intel', () => {
  vi.stubEnv('ADSCOUT_STORE_DIR', undefined);
  vi.stubEnv('DATA_DIR', undefined);
  vi.stubEnv('VERCEL', undefined);
  expect(storeDir()).toBe(path.join(process.cwd(), 'data', 'ad-intel'));
});
