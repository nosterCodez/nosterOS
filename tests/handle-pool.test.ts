import { afterEach, expect, test, vi } from 'vitest';
import { HandlePool } from '@/lib/handle-pool';
afterEach(() => vi.useRealTimers());

test('leased handles survive awaits and cannot be evicted', async () => {
  const closed: string[] = [];
  const pool = new HandlePool((key: string) => ({ key, close: () => { closed.push(key); } }), 2);
  const lease = pool.acquire('a');
  pool.get('b'); await Promise.resolve(); pool.get('c');
  expect(closed).toEqual([]); expect(lease.value.key).toBe('a');
  expect(() => pool.closeAll()).toThrow('in use');
  lease.release(); lease.release();
  pool.closeAll(); expect(closed.sort()).toEqual(['a', 'b', 'c']);
});
test('evicted handles close after 60 seconds and revive without duplicate opens', () => {
  vi.useFakeTimers(); const closed: string[] = [];
  const open = vi.fn((key: string) => ({ key, close: () => { closed.push(key); } }));
  const pool = new HandlePool(open, 1);
  const original = pool.get('a'); pool.get('b'); vi.advanceTimersByTime(59_999);
  expect(closed).toEqual([]); expect(pool.get('a')).toBe(original); expect(open).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1); expect(closed).toEqual([]);
  vi.advanceTimersByTime(59_999); expect(closed).toEqual(['b']);
  pool.closeAll(); expect(closed).toEqual(['b', 'a']);
});
test('closing list is bounded and never closes handles early to make room', () => {
  vi.useFakeTimers(); const close = vi.fn(); const pool = new HandlePool(() => ({ close }), 1);
  pool.get('a'); pool.get('b'); expect(pool.openSize).toBe(2);
  expect(() => pool.get('c')).toThrow('capacity'); expect(close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000); pool.get('c'); expect(pool.openSize).toBe(2);
  pool.closeAll();
});
test('all handles busy fails closed within capacity and recovers after release', () => {
  const pool = new HandlePool((key: string) => ({ key, close() {} }), 1);
  const lease = pool.acquire('a');
  expect(() => pool.acquire('b')).toThrow('capacity'); expect(pool.size).toBe(1);
  lease.release(); const next = pool.acquire('b'); expect(next.value.key).toBe('b');
  next.release(); pool.closeAll();
});
test('withHandle releases on rejection and supports nested leases for one workspace', async () => {
  const pool = new HandlePool((key: string) => ({ key, close() {} }), 1);
  await expect(pool.withHandle('a', async () => {
    const nested = pool.acquire('a'); nested.release(); throw new Error('job failed');
  })).rejects.toThrow('job failed');
  expect(pool.get('b').key).toBe('b'); pool.closeAll();
});
