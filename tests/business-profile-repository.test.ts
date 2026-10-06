import { afterEach, expect, test } from 'vitest';
import { openDb } from '@/lib/db';
const dbs: ReturnType<typeof openDb>[] = [];
const open = () => { const db = openDb(':memory:'); dbs.push(db); return db; };
afterEach(() => { dbs.splice(0).forEach(db => db.close()); });
test('workspace profile saves, restores as a new version and retains only 20', () => {
  const a = open(), b = open();
  expect(a.businessProfiles.current()).toBeNull();
  const first = a.businessProfiles.save('## Business overview\nFirst', 'user');
  expect(first.version).toBe(1); expect(first.promptVersion).toBe(1);
  a.businessProfiles.save('## Business overview\nSecond', 'user');
  expect(a.businessProfiles.restore(first.id, 'other-user')).toMatchObject({ version: 3, createdByUserId: 'other-user', rawMarkdown: first.rawMarkdown });
  expect(b.businessProfiles.current()).toBeNull();
  expect(b.businessProfiles.get(first.id)).toBeNull();
  expect(() => b.businessProfiles.restore(first.id, 'user')).toThrow('Profile version not found');
  for (let i = 0; i < 23; i++) a.businessProfiles.save(`## Business overview\nVersion ${i}`, 'user');
  const versions = a.businessProfiles.list();
  expect(versions).toHaveLength(20); expect(versions[0].version).toBe(26);
  expect(versions.filter(v => v.isCurrent)).toHaveLength(1);
  expect(a.businessProfiles.get(first.id)).toBeNull();
});
test('secret or invalid input leaves existing profile and version history untouched', () => {
  const db = open(); db.businessProfiles.save('## Business overview\nSafe', 'user');
  expect(() => db.businessProfiles.save('## Business overview\nsk-test-fakeSecret123456789', 'user')).toThrow();
  expect(() => db.businessProfiles.save('x'.repeat(40001), 'user')).toThrow();
  expect(db.businessProfiles.list()).toHaveLength(1);
  expect(db.businessProfiles.current()?.sections.business_overview).toBe('Safe');
});
