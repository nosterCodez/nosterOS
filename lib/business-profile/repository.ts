import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BusinessProfile, ProfileVersion } from './schema';
import { parseBusinessProfile } from './parser';
import { PROMPT_VERSION } from './prompt';
const Row = z.object({ id: z.string(), version: z.number(), prompt_version: z.number(), raw_markdown: z.string(), sections_json: z.string(), completeness_json: z.string(), created_by_user_id: z.string(), created_at: z.string(), is_current: z.union([z.literal(0), z.literal(1)]) });
function read(input: unknown): BusinessProfile {
  const row = Row.parse(input);
  return BusinessProfile.parse({ id: row.id, version: row.version, promptVersion: row.prompt_version, rawMarkdown: row.raw_markdown,
    sections: JSON.parse(row.sections_json), completeness: JSON.parse(row.completeness_json), createdByUserId: row.created_by_user_id,
    createdAt: row.created_at, isCurrent: row.is_current === 1 });
}
export function createBusinessProfiles(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS business_profiles (
    id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, prompt_version INTEGER NOT NULL,
    raw_markdown TEXT NOT NULL, sections_json TEXT NOT NULL, completeness_json TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, is_current INTEGER NOT NULL CHECK(is_current IN (0,1)));
    CREATE UNIQUE INDEX IF NOT EXISTS business_profiles_current ON business_profiles(is_current) WHERE is_current=1;`);
  function get(id: string) {
    const row = db.prepare('SELECT * FROM business_profiles WHERE id=?').get(z.string().uuid().parse(id));
    return row ? read(row) : null;
  }
  function insert(markdown: string, userId: string, promptVersion = PROMPT_VERSION) {
    const parsed = parseBusinessProfile(markdown);
    const next = db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM business_profiles').get() as { version: number };
    const profile = BusinessProfile.parse({ ...parsed, id: randomUUID(), version: next.version, promptVersion,
      createdByUserId: userId, createdAt: new Date().toISOString(), isCurrent: true });
    db.prepare('UPDATE business_profiles SET is_current=0 WHERE is_current=1').run();
    db.prepare('INSERT INTO business_profiles VALUES (?,?,?,?,?,?,?,?,?)').run(profile.id, profile.version, profile.promptVersion,
      profile.rawMarkdown, JSON.stringify(profile.sections), JSON.stringify(profile.completeness), profile.createdByUserId, profile.createdAt, 1);
    db.prepare('DELETE FROM business_profiles WHERE id NOT IN (SELECT id FROM business_profiles ORDER BY version DESC LIMIT 20)').run();
    return profile;
  }
  return {
    get,
    current() { const row = db.prepare('SELECT * FROM business_profiles WHERE is_current=1').get(); return row ? read(row) : null; },
    list(): ProfileVersion[] { return db.prepare('SELECT * FROM business_profiles ORDER BY version DESC LIMIT 20').all().map(row => {
      const { rawMarkdown, sections, completeness, ...version } = read(row);
      return ProfileVersion.parse(version);
    }); },
    save(markdown: string, userId: string) { return db.transaction(() => insert(markdown, userId)).immediate(); },
    restore(id: string, userId: string) { return db.transaction(() => { const old = get(id); if (!old) throw new Error('Profile version not found'); return insert(old.rawMarkdown, userId, old.promptVersion); }).immediate(); },
  };
}
