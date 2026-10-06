import { afterEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { rulesPlan } from '@/lib/leads/plan';
import { runLeadBatch } from '@/lib/leads/runner';
import type { LeadSource, Place } from '@/lib/leads/sources/types';
const stores: ReturnType<typeof openDb>[] = [];
const now = new Date('2026-10-06T12:00:00Z');
const A = 'A'.repeat(32), B = 'B'.repeat(32);
function setup(cities = ['Mission']) {
  const db = openDb(':memory:'); stores.push(db);
  db.businessProfiles.save('## Business overview\nTest\n## Service area\nMission', 'owner');
  const profile = db.businessProfiles.current()!, p = rulesPlan(profile);
  p.targets[0].cities = cities;
  const draft = db.leadPlans.saveDraft({ plan: p, generatedBy: 'rules', profileVersion: profile.version });
  db.leadPlans.activate(draft.id, { id: 'owner', role: 'owner' }, profile.version);
  return { db, plan: db.leadPlans.active()! };
}
function place(id: string): Place { return { source: 'foursquare', id, name: id, category: '', address: '', city: 'Mission', latitude: 26, longitude: -98, website: '', phone: '', refreshedAt: now.toISOString() }; }
afterEach(() => { stores.splice(0).forEach(db => db.close()); });
test('schedule keys are idempotent, cities deduped, and Run now is capped at three per UTC day', () => {
  const { db, plan } = setup(['Mission', 'mission']);
  const first = db.leadJobs.enqueue(plan, 'scheduled', 'daily', now);
  expect(db.leadJobs.enqueue(plan, 'scheduled', 'daily', now)).toMatchObject({ ...first, created: false });
  expect(db.leadJobs.jobs(first.ok ? first.id : '')).toHaveLength(2);
  for (let i = 0; i < 3; i++) expect(db.leadJobs.enqueue(plan, 'manual', 'daily', now).ok).toBe(true);
  expect(db.leadJobs.enqueue(plan, 'manual', 'daily', now)).toMatchObject({ reason: 'manual_daily_limit' });
  expect(db.leadJobs.enqueue(plan, 'manual', 'daily', new Date(+now + 86400000)).ok).toBe(true);
});
test('crashed jobs resume with new leases; stale owners cannot complete and dispatched Overpass never repeats', () => {
  const { db, plan } = setup(); db.leadJobs.enqueue(plan, 'manual', 'daily', now);
  const old = db.leadJobs.claim(plan.id, now)!; expect(old.source).toBe('overpass');
  expect(db.leadJobs.markRequested(old)).toBe(true);
  const next = db.leadJobs.claim(plan.id, new Date(+now + 61000))!;
  expect(db.leadJobs.get(old.id)?.state).toBe('failed'); expect(next.source).toBe('foursquare');
  const renewed = db.leadJobs.claim(plan.id, new Date(+now + 122000))!;
  expect(renewed.id).toBe(next.id); expect(renewed.lease).not.toBe(next.lease);
  expect(db.leadJobs.complete(next, [place('stale')], now)).toBe(false);
  expect(db.leadJobs.complete(renewed, [place('fresh')], now)).toBe(true);
});
test('retry backoff is one minute then ten minutes and ends after three attempts', () => {
  const { db, plan } = setup(); db.leadJobs.enqueue(plan, 'manual', 'daily', now);
  const osm = db.leadJobs.claim(plan.id, now)!; db.leadJobs.fail(osm, 'source_not_imported', now);
  const first = db.leadJobs.claim(plan.id, now)!; db.leadJobs.fail(first, 'source_unavailable', now);
  expect(db.leadJobs.claim(plan.id, new Date(+now + 59999))).toBeNull();
  const second = db.leadJobs.claim(plan.id, new Date(+now + 60000))!; db.leadJobs.fail(second, 'source_unavailable', new Date(+now + 60000));
  expect(db.leadJobs.claim(plan.id, new Date(+now + 659999))).toBeNull();
  const third = db.leadJobs.claim(plan.id, new Date(+now + 660000))!; db.leadJobs.fail(third, 'source_unavailable', new Date(+now + 660000));
  expect(db.leadJobs.get(third.id)).toMatchObject({ state: 'failed', attempts: 3 });
});
test('weekly target is enforced atomically when two claimed jobs finish', () => {
  const { db, plan } = setup(); db.leadJobs.enqueue(plan, 'manual', 'daily', now);
  const a = db.leadJobs.claim(plan.id, now)!, b = db.leadJobs.claim(plan.id, now)!;
  db.leadJobs.complete(a, [place('1'), place('2'), place('3')], now, 5);
  db.leadJobs.complete(b, [place('4'), place('5'), place('6')], now, 5);
  expect(db.leadJobs.countSince(now)).toBe(5);
});
test('runner rotates workspaces, respects item cap, and isolates persisted results', async () => {
  const a = setup(), b = setup(), calls: string[] = [];
  const sources: LeadSource[] = ['overpass', 'foursquare'].map(id => ({ id: id as LeadSource['id'], costPerCallUsd: 0, attribution: '', attributionUrl: '', find: vi.fn(async () => [place('public')]) }));
  const env = { OMEGA_LEAD_ENGINE: '1', OMEGA_LEAD_ENGINE_WORKSPACES: `${A},${B}` };
  const result = await runLeadBatch({ workspaces: [{ id: A }, { id: B }], env, now: () => +now, offset: 0, maxItems: 2, sources,
    withDb: async (id, work) => { calls.push(id); return work(id === A ? a.db : b.db); } });
  expect(result.ran).toBe(2); expect(calls).toEqual([A, B]);
  expect(a.db.leadJobs.countSince(now)).toBe(1); expect(b.db.leadJobs.countSince(now)).toBe(1);
  expect(a.db.leadJobs.recent()[0].id).not.toBe(b.db.leadJobs.recent()[0].id);
});
test('disabled flag and stale profile prevent database/provider work respectively', async () => {
  const withDb = vi.fn(); expect(await runLeadBatch({ workspaces: [{ id: A }], env: {}, sources: [], withDb })).toMatchObject({ ran: 0 }); expect(withDb).not.toHaveBeenCalled();
  const { db } = setup(); db.businessProfiles.save('## Business overview\nChanged', 'owner');
  const find = vi.fn(); await runLeadBatch({ workspaces: [{ id: A }], env: { OMEGA_LEAD_ENGINE: '1', OMEGA_LEAD_ENGINE_WORKSPACES: A }, sources: [{ id: 'overpass', costPerCallUsd: 0, attribution: '', attributionUrl: '', find }], withDb: async (_id, work) => work(db) });
  expect(find).not.toHaveBeenCalled(); expect(db.leadJobs.recent()).toEqual([]);
});
test('wall-time bound aborts slow provider and records no late results', async () => {
  const { db } = setup(), find = vi.fn(() => new Promise<Place[]>(resolve => setTimeout(() => resolve([place('late')]), 60)));
  const start = Date.now();
  const result = await runLeadBatch({ workspaces: [{ id: A }], env: { OMEGA_LEAD_ENGINE: '1', OMEGA_LEAD_ENGINE_WORKSPACES: A }, budgetMs: 20,
    sources: [{ id: 'overpass', costPerCallUsd: 0, attribution: '', attributionUrl: '', find }], withDb: async (_id, work) => work(db) });
  expect(result.ran).toBe(1); expect(Date.now() - start).toBeLessThan(500);
  await new Promise(resolve => setTimeout(resolve, 65)); expect(db.leadJobs.countSince(new Date())).toBe(0);
});
test('runner never exceeds 25 jobs even when caller requests a larger batch', async () => {
  const { db, plan } = setup(Array.from({ length: 10 }, (_, i) => `City ${i}`));
  db.leadJobs.enqueue(plan, 'manual', 'daily', now);
  const find = vi.fn(async () => []);
  const sources: LeadSource[] = ['overpass', 'foursquare'].map(id => ({ id: id as LeadSource['id'], costPerCallUsd: 0, attribution: '', attributionUrl: '', find }));
  const result = await runLeadBatch({ workspaces: [{ id: A }], env: { OMEGA_LEAD_ENGINE: '1', OMEGA_LEAD_ENGINE_WORKSPACES: A }, maxItems: 100, now: () => +now, sources, withDb: async (_id, work) => work(db) });
  expect(result.ran).toBe(25); expect(find).toHaveBeenCalledTimes(25);
});
