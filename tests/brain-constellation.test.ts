import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  MEMORY_TTL_MS,
  isConstellationWarm,
  memoryConstellation,
  warmBrainConstellation,
  wikiFor,
  __resetForTests,
} from '@/lib/brain-constellation';

/**
 * buildBrainGraph over the real brain-store + vault is genuinely slow --
 * measured 9+ seconds over 1,974 combined notes (2026-09-06, after the
 * ZeroEntropy->Ollama migration grew the store from ~900 to 1,290 pages).
 * That is fine to pay once and cache; it stopped being fine the moment a
 * cache MISS put that 9s (plus wiki indexing) directly in a request's path
 * with the page frozen and no feedback -- which `gbrain doctor`-adjacent
 * tooling would never catch, only a real click would. These tests exercise
 * the caching contract with tiny fixture notes, never the real store, so the
 * suite stays fast and deterministic.
 */
const store = [{ path: 'a.md', content: '# A' }];
const vault = [{ path: 'b.md', content: '# B' }];
let now = 0;
const deps = () => ({ readStoreNotes: vi.fn(() => store), readVaultNotes: vi.fn(() => vault), now: () => now });

beforeEach(() => {
  now = 1_000_000;
  __resetForTests();
});

describe('memoryConstellation caching', () => {
  test('a cold call reads both sources and caches the result', () => {
    const d = deps();
    const value = memoryConstellation('A'.repeat(32), d);
    expect(d.readStoreNotes).toHaveBeenCalledTimes(1);
    expect(d.readVaultNotes).toHaveBeenCalledTimes(1);
    expect(value).toBeDefined();
  });

  test('a call inside the TTL reuses the cache and touches neither source', () => {
    const d = deps();
    memoryConstellation('A'.repeat(32), d);
    now += 1000;
    memoryConstellation('A'.repeat(32), d);
    expect(d.readStoreNotes).toHaveBeenCalledTimes(1);
    expect(d.readVaultNotes).toHaveBeenCalledTimes(1);
  });

  test('a call past the TTL recomputes -- this IS the periodic cost, and it must land on the sweep, not a click', () => {
    const d = deps();
    memoryConstellation('A'.repeat(32), d);
    now += MEMORY_TTL_MS + 1;
    memoryConstellation('A'.repeat(32), d);
    expect(d.readStoreNotes).toHaveBeenCalledTimes(2);
  });

  test('a store read failure does not fabricate a non-demo workspace graph', () => {
    const d = { readStoreNotes: vi.fn(() => { throw new Error('no store on this box'); }), readVaultNotes: vi.fn(() => []), now: () => now };
    expect(() => memoryConstellation('A'.repeat(32), d)).not.toThrow();
    expect(memoryConstellation('A'.repeat(32), d)).toBeUndefined();
  });
});

test('memory and wiki caches never reuse another workspace result', () => {
  const a = deps();
  const b = { ...deps(), readStoreNotes: vi.fn(() => [{ path: 'private-b.md', content: '# Only B' }]), readVaultNotes: vi.fn(() => []) };
  const first = memoryConstellation('A'.repeat(32), a);
  const second = memoryConstellation('B'.repeat(32), b);
  expect(second).not.toEqual(first);
  wikiFor('A'.repeat(32), ['a'], [], a);
  wikiFor('B'.repeat(32), ['a'], [], b);
  expect(a.readStoreNotes).toHaveBeenCalledTimes(2);
  expect(b.readStoreNotes).toHaveBeenCalledTimes(2);
  warmBrainConstellation('A'.repeat(32), a);
  memoryConstellation('B'.repeat(32), b);
  expect(b.readStoreNotes).toHaveBeenCalledTimes(2);
  expect(() => memoryConstellation('../', a)).toThrow();
});

describe('wikiFor caching', () => {
  test('caches the built index and only re-subsets on repeat calls inside the TTL', () => {
    const d = deps();
    wikiFor('A'.repeat(32), ['a'], [], d);
    now += 1000;
    wikiFor('A'.repeat(32), ['b'], [], d);
    expect(d.readStoreNotes).toHaveBeenCalledTimes(1); // one build, two different subsets
  });
});

describe('warmBrainConstellation', () => {
  test('forces both caches to rebuild right now, regardless of TTL state', () => {
    const d = deps();
    memoryConstellation('A'.repeat(32), d);
    expect(isConstellationWarm('A'.repeat(32), d)).toBe(true);
    warmBrainConstellation('A'.repeat(32), d);
    // still warm after an explicit warm call -- this is the sweep's job
    expect(isConstellationWarm('A'.repeat(32), d)).toBe(true);
    expect(d.readStoreNotes.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('after warming, the next page render pays nothing -- the whole point', () => {
    const d = deps();
    warmBrainConstellation('A'.repeat(32), d);
    const callsAfterWarm = d.readStoreNotes.mock.calls.length;
    memoryConstellation('A'.repeat(32), d);
    wikiFor('A'.repeat(32), [], [], d);
    expect(d.readStoreNotes.mock.calls.length).toBe(callsAfterWarm); // no new reads
  });
});

describe('isConstellationWarm', () => {
  test('false before anything has been computed', () => {
    expect(isConstellationWarm('A'.repeat(32), deps())).toBe(false);
  });

  test('false again once the TTL has lapsed, so a health check can tell the sweep missed a beat', () => {
    const d = deps();
    memoryConstellation('A'.repeat(32), d);
    now += MEMORY_TTL_MS + 1;
    expect(isConstellationWarm('A'.repeat(32), d)).toBe(false);
  });
});
