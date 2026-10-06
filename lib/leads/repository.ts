import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LeadPlan, PlanRecord, Preferences, GeneratedBy, mergePreferences } from './schema';
const Row = z.object({ id: z.string(), version: z.number(), profile_version: z.number(), plan_json: z.string(), status: z.string(),
  generated_by: z.string(), created_at: z.string(), approved_by_user_id: z.string().nullable(), approved_at: z.string().nullable() });
const UserId = z.string().min(1).max(200);
function read(input: unknown): PlanRecord {
  const r = Row.parse(input);
  return PlanRecord.parse({ id: r.id, version: r.version, profileVersion: r.profile_version, plan: JSON.parse(r.plan_json), status: r.status,
    generatedBy: r.generated_by, createdAt: r.created_at, approvedByUserId: r.approved_by_user_id, approvedAt: r.approved_at });
}
export function createLeadPlans(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS lead_plans (id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE,
    profile_version INTEGER NOT NULL, plan_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','active','archived')),
    generated_by TEXT NOT NULL, created_at TEXT NOT NULL, approved_by_user_id TEXT, approved_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS lead_plan_active ON lead_plans(status) WHERE status='active';
    CREATE TABLE IF NOT EXISTS lead_preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('answer','edit','default')), updated_by_user_id TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  const one = (query: string, ...params: string[]) => { const row = db.prepare(query).get(...params); return row ? read(row) : null; };
  const get = (id: string) => one('SELECT * FROM lead_plans WHERE id=?', z.string().uuid().parse(id));
  function preferences(): Preferences {
    const rows = z.array(z.object({ key: z.string(), value_json: z.string(), source: z.enum(['answer', 'edit', 'default']),
      updated_by_user_id: UserId, updated_at: z.string().datetime() })).parse(db.prepare('SELECT * FROM lead_preferences').all());
    return Preferences.parse(Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value_json)])));
  }
  function putPreferences(input: Preferences, userId: string, source: 'answer' | 'edit' | 'default') {
    const value = Preferences.parse(input); UserId.parse(userId); z.enum(['answer', 'edit', 'default']).parse(source);
    for (const [key, item] of Object.entries(value)) db.prepare(`INSERT INTO lead_preferences VALUES (?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,source=excluded.source,
      updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`).run(key, JSON.stringify(item), source, userId, new Date().toISOString());
  }
  const DraftInput = z.object({ plan: LeadPlan, profileVersion: z.number().int().positive(), generatedBy: GeneratedBy }).strict();
  function insert(input: z.infer<typeof DraftInput>): PlanRecord {
    const parsed = DraftInput.parse(input);
    const version = db.prepare('SELECT COALESCE(MAX(version),0)+1 FROM lead_plans').pluck().get() as number;
    const item = PlanRecord.parse({ ...parsed, id: randomUUID(), version, status: 'draft', createdAt: new Date().toISOString(), approvedAt: null, approvedByUserId: null });
    db.prepare('INSERT INTO lead_plans VALUES (?,?,?,?,?,?,?,?,?)').run(item.id, item.version, item.profileVersion, JSON.stringify(item.plan), item.status,
      item.generatedBy, item.createdAt, null, null);
    return item;
  }
  return { get, preferences,
    latest: () => one('SELECT * FROM lead_plans ORDER BY version DESC LIMIT 1'),
    active: () => one("SELECT * FROM lead_plans WHERE status='active'"),
    saveDraft(input: z.infer<typeof DraftInput>) { return db.transaction(() => insert(input)).immediate(); },
    edit(id: string, input: LeadPlan, userId: string) {
      return db.transaction(() => {
        const old = get(id); if (!old) throw new Error('Plan not found');
        const plan = LeadPlan.parse(input);
        const changes = Object.fromEntries(Object.entries(plan).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(old.plan[key as keyof LeadPlan])));
        putPreferences(changes, userId, 'edit');
        return insert({ plan, profileVersion: old.profileVersion, generatedBy: old.generatedBy });
      }).immediate();
    },
    answer(id: string, patch: Preferences, userId: string, source: 'answer' | 'default') {
      return db.transaction(() => { const old = get(id); if (!old) throw new Error('Plan not found');
        putPreferences(patch, userId, source);
        return insert({ plan: mergePreferences(old.plan, patch), profileVersion: old.profileVersion, generatedBy: old.generatedBy });
      }).immediate();
    },
    activate(id: string, actor: { id: string; role: string }, currentProfileVersion: number) {
      UserId.parse(actor.id); if (!['owner', 'admin'].includes(actor.role)) throw new Error('Owner/admin required');
      return db.transaction(() => { const item = get(id); if (!item) throw new Error('Plan not found');
        if (item.profileVersion !== currentProfileVersion) throw new Error('Profile changed; generate and review a new plan');
        if (item.plan.targets.some(t => !t.cities.length)) throw new Error('Choose target cities before activation');
        if (item.status === 'active') return item;
        if (item.status !== 'draft') throw new Error('Only drafts can be activated');
        db.prepare("UPDATE lead_plans SET status='archived' WHERE status='active'").run();
        db.prepare("UPDATE lead_plans SET status='active',approved_by_user_id=?,approved_at=? WHERE id=?").run(actor.id, new Date().toISOString(), id);
        return get(id)!;
      }).immediate();
    },
  };
}
