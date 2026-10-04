import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '@/lib/auth';
import { bootstrapOperator } from '@/lib/operator-bootstrap';
import { operatorWorkspaceId } from '@/lib/operator-workspace';

const email = 'owner@example.com', userId = 'U'.repeat(32);
let root: string;
let db: Database.Database;
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'nosteros-bootstrap-'));
  db = new Database(path.join(root, 'control.db'));
  const auth = createAuth(db, { baseURL: 'http://localhost:4100', secret: 'bootstrap-test-only-secret-at-least-32-characters', send: async () => {} });
  await (await getMigrations(auth.options)).runMigrations();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(userId, 'Owner', email, 1, Date.now(), Date.now());
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const run = () => bootstrapOperator({ root, ownerEmail: email });

test('fresh verified owner receives an agency binding; repeat runs change nothing', () => {
  const result = run();
  expect(result.status).toBe('created');
  expect(db.prepare('SELECT name,slug,metadata FROM organization').all()).toEqual([{ name: 'nosterCodes', slug: 'nostercodes', metadata: '{"kind":"agency"}' }]);
  expect(db.prepare('SELECT organizationId,userId,role FROM member').all()).toEqual([{ organizationId: result.workspaceId, userId, role: 'owner' }]);
  const before = db.serialize();
  expect(run()).toEqual({ status: 'already-complete', workspaceId: result.workspaceId });
  expect(db.serialize()).toEqual(before);
  expect(readdirSync(root).some(name => name === 'workspaces')).toBe(false);
  vi.stubEnv('DATA_DIR', root); vi.stubEnv('NOSTEROS_OWNER_EMAIL', email);
  expect(operatorWorkspaceId()).toBe(result.workspaceId);
});
test('missing or unverified owner cannot bootstrap or create a user', () => {
  expect(() => bootstrapOperator({ root, ownerEmail: 'missing@example.com' })).toThrow('verified sign-in');
  db.prepare('UPDATE user SET emailVerified=0').run();
  expect(run).toThrow('verified sign-in');
  expect(db.prepare('SELECT id FROM organization').all()).toEqual([]);
  expect(db.prepare('SELECT id FROM user').all()).toHaveLength(1);
});
test('legacy data and demo mode fail without touching the data', () => {
  expect(() => bootstrapOperator({ root, ownerEmail: email, demo: true })).toThrow('DEMO_GATE');
  writeFileSync(path.join(root, 'founder-os.db'), 'preserve legacy');
  expect(run).toThrow('Legacy data');
  expect(readFileSync(path.join(root, 'founder-os.db'), 'utf8')).toBe('preserve legacy');
  expect(db.prepare('SELECT id FROM organization').all()).toEqual([]);
});
test('existing unbound name or slug cannot be silently adopted', () => {
  db.prepare('INSERT INTO organization (id,name,slug,metadata,createdAt) VALUES (?,?,?,?,?)').run('W'.repeat(32), 'nosterCodes', 'other', '{"kind":"agency"}', Date.now());
  expect(run).toThrow('no operator binding');
  expect(db.prepare('SELECT id FROM organization').all()).toHaveLength(1);
  expect(db.prepare('SELECT id FROM member').all()).toEqual([]);
});
test('changed owner or removed ownership never rewrites the binding', () => {
  run();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run('V'.repeat(32), 'Other', 'other@example.com', 1, Date.now(), Date.now());
  expect(() => bootstrapOperator({ root, ownerEmail: 'other@example.com' })).toThrow('conflicts');
  db.prepare("UPDATE member SET role='member'").run();
  expect(run).toThrow('conflicts');
  expect(db.prepare('SELECT ownerUserId FROM nosteros_operator').get()).toEqual({ ownerUserId: userId });
});
test('failure when binding is written rolls back organization and membership', () => {
  db.exec("CREATE TABLE nosteros_operator (id INTEGER PRIMARY KEY, organizationId TEXT, ownerUserId TEXT); CREATE TRIGGER reject_binding BEFORE INSERT ON nosteros_operator BEGIN SELECT RAISE(ABORT, 'test binding failure'); END");
  expect(run).toThrow('test binding failure');
  expect(db.prepare('SELECT id FROM organization').all()).toEqual([]);
  expect(db.prepare('SELECT id FROM member').all()).toEqual([]);
});
