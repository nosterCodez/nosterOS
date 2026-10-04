/**
 * Cached brain-store + vault distillation and wiki index behind /brain.
 *
 * `buildBrainGraph` does real work over every store+vault note: on the order
 * of seconds once a store holds a couple of thousand notes. The cost scales
 * with note count, not with the TTL that was supposed to hide it, so it grows
 * with the store rather than staying flat.
 *
 * That cost was already behind an in-process cache, and paying it once is
 * fine. What was NOT fine: the cache lived as `let` state inside
 * app/brain/page.tsx, so nothing outside a page render could ever warm it.
 * Every TTL expiry, every dev-server recompile, and every fresh deploy reset
 * it to empty, and the very next person to click G-Brain eat the full 9-16s
 * (memory constellation + wiki index) with the page frozen -- confirmed by
 * instrumenting the cache directly: back-to-back requests both took ~16s
 * because each landed on a freshly re-instantiated module.
 *
 * The fix is the same shape already proven for comms (see the
 * comms-page-performance memory): pull the cache out where a background
 * sweep can reach it, and warm it there instead of on a click. This module is
 * that shared surface -- app/brain/page.tsx reads through it exactly as
 * before, and POST /api/analytics/refresh (+ its boot-time prime in
 * instrumentation.ts) now warms it too, so in practice the 9s cost lands on
 * the 15-minute sweep, never on the operator.
 *
 * Dependency-injectable (`readStoreNotes`/`readVaultNotes`/`now`) so the test
 * suite exercises the caching CONTRACT against tiny fixtures in milliseconds,
 * never a full-sized store.
 */
import { buildBrainGraph } from '@/lib/brain-graph';
import { readStoreNotes as realReadStoreNotes } from '@/lib/connectors/gbrain';
import { readVaultNotes as realReadVaultNotes } from '@/lib/connectors/obsidian';
import { agentSlug, buildWikiIndex, pickWikiEntries, toolSlug, type WikiIndex } from '@/lib/brain-wiki';
import { demoMemoryGraph, distillMemoryGraph, type MemoryGraph } from '@/lib/memory-core';
import path from 'node:path';
import { workspaceDir } from '@/lib/paths';

export const MEMORY_TTL_MS = 5 * 60_000;
export const WIKI_TTL_MS = 5 * 60_000;

type Note = { path: string; content: string };

export type ConstellationDeps = {
  readStoreNotes: () => Note[];
  readVaultNotes: () => Note[];
  now: () => number;
};

function realDeps(workspaceId: string): ConstellationDeps {
  const dir = workspaceDir(workspaceId);
  return {
    readStoreNotes: () => realReadStoreNotes(path.join(dir, 'brain-store')),
    readVaultNotes: () => realReadVaultNotes(path.join(dir, 'vault')),
    now: Date.now,
  };
}
type Cache = { memory?: { at: number; value: MemoryGraph | undefined }; wiki?: { at: number; value: WikiIndex } };
const caches = new Map<string, Cache>();
function cacheFor(workspaceId: string): Cache {
  workspaceDir(workspaceId);
  const cache = caches.get(workspaceId) ?? {};
  caches.delete(workspaceId);
  if (caches.size >= 50) caches.delete(caches.keys().next().value!);
  caches.set(workspaceId, cache);
  return cache;
}
const fallback = () => process.env.DEMO_GATE === '1' ? demoMemoryGraph() : undefined;

/**
 * The operator's memory = the brain-store PLUS the Obsidian vault (the Claude
 * Archive is the bulk of it). Store notes win path collisions; each source
 * keeps its own folders so the constellation clusters by real structure.
 * Never throws: an unreadable store yields the demo stand-in rather than a
 * broken page.
 */
export function memoryConstellation(workspaceId: string, deps: ConstellationDeps = realDeps(workspaceId)): MemoryGraph | undefined {
  const cache = cacheFor(workspaceId);
  const memoryCache = cache.memory;
  if (memoryCache && deps.now() - memoryCache.at < MEMORY_TTL_MS) return memoryCache.value;
  let value: MemoryGraph | undefined;
  try {
    const store = deps.readStoreNotes();
    const seen = new Set(store.map((n) => n.path));
    const vault = deps.readVaultNotes().filter((n) => !seen.has(n.path));
    // the Claude Archive (652 conversations) is spotlighted: a guaranteed
    // slice of the page cap and its cluster centered in the disc
    const distilled = distillMemoryGraph(buildBrainGraph([...store, ...vault]), {
      centerFolder: 'Claude Archive',
    });
    value = distilled.nodes.length > 0 ? distilled : fallback();
  } catch {
    value = fallback();
  }
  cache.memory = { at: deps.now(), value };
  return value;
}

/**
 * The wiki index behind the agent + tool nodes: the real brain-store page for
 * each, with its stated fields and its actual links in and out. Parsing the
 * whole store is the same cost class as the constellation, so it shares its
 * cadence. Only the pages the graph can actually open are returned to the
 * caller, never the whole index.
 */
export function wikiFor(workspaceId: string, agentIds: string[], toolSlugs: string[], deps: ConstellationDeps = realDeps(workspaceId)): WikiIndex {
  const cache = cacheFor(workspaceId);
  let wikiCache = cache.wiki;
  if (!wikiCache || deps.now() - wikiCache.at >= WIKI_TTL_MS) {
    let value: WikiIndex = {};
    try {
      value = buildWikiIndex(deps.readStoreNotes());
    } catch {
      // No store on this box (the Vercel demo). An empty index is honest: the
      // panels then say "no page in the brain-store yet" rather than inventing.
      value = {};
    }
    wikiCache = { at: deps.now(), value };
    cache.wiki = wikiCache;
  }
  return pickWikiEntries(wikiCache.value, [...agentIds.map(agentSlug), ...toolSlugs.map(toolSlug)]);
}

/**
 * Force both caches to rebuild right now. This is the function the analytics
 * refresh sweep and the boot warmup call -- the ~9s recompute happens on
 * their clock, in the background, instead of on whoever's click loses the TTL
 * race.
 */
export function warmBrainConstellation(workspaceId: string, deps: ConstellationDeps = realDeps(workspaceId)): void {
  caches.delete(workspaceId);
  memoryConstellation(workspaceId, deps);
  wikiFor(workspaceId, [], [], deps);
}

/** For a health check: is the expensive path currently cached, or is the
    next real click about to pay for it? */
export function isConstellationWarm(workspaceId: string, deps: ConstellationDeps = realDeps(workspaceId)): boolean {
  const memoryCache = cacheFor(workspaceId).memory;
  return Boolean(memoryCache) && deps.now() - memoryCache!.at < MEMORY_TTL_MS;
}

/** Test-only: clear module state between cases. Not exported for app use. */
export function __resetForTests(): void {
  caches.clear();
}
