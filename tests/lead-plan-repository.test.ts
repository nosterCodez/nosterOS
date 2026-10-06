import { afterEach, expect, test } from 'vitest';
import { openDb } from '@/lib/db';
import { rulesPlan } from '@/lib/leads/plan';
const dbs: ReturnType<typeof openDb>[] = [];
const open = () => { const db = openDb(':memory:'); dbs.push(db); return db; };
afterEach(() => dbs.splice(0).forEach(db => db.close()));
const actor = { id: 'owner', role: 'owner' as const };
function setup() { const db = open(), profile = db.businessProfiles.save('## Business overview\nFixture\n## Service area\nMission', 'owner');
  const draft = db.leadPlans.saveDraft({ plan: rulesPlan(profile), profileVersion: profile.version, generatedBy: 'rules' }); return { db, profile, draft }; }
test('workspace-local versioning, strict reads and only one owner/admin-approved active plan', () => {
  const { db, profile, draft } = setup(), other = open();
  expect(other.leadPlans.get(draft.id)).toBeNull(); expect(other.leadPlans.latest()).toBeNull();
  expect(() => db.leadPlans.activate(draft.id, { id: 'member', role: 'member' }, profile.version)).toThrow();
  expect(() => db.leadPlans.activate(draft.id, { id: 'viewer', role: 'viewer' }, profile.version)).toThrow();
  expect(db.leadPlans.activate(draft.id, actor, profile.version)).toMatchObject({ status: 'active', approvedByUserId: 'owner' });
  const next = db.leadPlans.edit(draft.id, { ...draft.plan, tone: 'My choice' }, 'owner');
  expect(next.version).toBe(2); expect(next.status).toBe('draft'); expect(db.leadPlans.active()?.id).toBe(draft.id);
  db.leadPlans.activate(next.id, { id: 'admin', role: 'admin' }, profile.version);
  expect(db.leadPlans.get(draft.id)?.status).toBe('archived'); expect(db.leadPlans.active()?.id).toBe(next.id);
  expect(db.leadPlans.preferences()).toMatchObject({ tone: 'My choice' });
});
test('changed profile cannot silently activate an old draft and answers persist in the workspace', () => {
  const { db, profile, draft } = setup();
  db.leadPlans.answer(draft.id, { weeklyLeadTarget: 50 }, 'owner', 'answer');
  expect(db.leadPlans.preferences()).toMatchObject({ weeklyLeadTarget: 50 });
  expect(() => db.leadPlans.activate(draft.id, actor, profile.version + 1)).toThrow('Profile changed');
  expect(() => db.leadPlans.edit(draft.id, { ...draft.plan, weeklyLeadTarget: 900 }, 'owner')).toThrow();
  expect(db.leadPlans.preferences().weeklyLeadTarget).toBe(50);
});
