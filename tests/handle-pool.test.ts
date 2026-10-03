import { expect, test } from 'vitest';
import { HandlePool } from '@/lib/handle-pool';

test('leased handles survive awaits and cannot be evicted', async () => {
  const closed: string[] = [];
  const pool = new HandlePool((key: string) => ({ key, close: () => { closed.push(key); } }), 2);
  const lease = pool.acquire('a');
  pool.get('b'); await Promise.resolve(); pool.get('c');
  expect(closed).toEqual(['b']); expect(lease.value.key).toBe('a');
  expect(() => pool.closeAll()).toThrow('in use');
  lease.release(); lease.release();
  pool.closeAll(); expect(closed.sort()).toEqual(['a', 'b', 'c']);
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
