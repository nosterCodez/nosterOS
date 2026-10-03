import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '@/lib/auth';
import { migrateToWorkspaces } from '@/lib/workspace-migration';

const roots: string[] = [];
const email = 'migration-owner@example.com';
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nosteros-migration-')); roots.push(root);
  const control = new Database(path.join(root, 'control.db'));
  const auth = createAuth(control, { baseURL: 'http://localhost:4100', secret: 'migration-test-only-secret-at-least-32-characters', send: async () => {} });
  await (await getMigrations(auth.options)).runMigrations();
  control.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
    .run('U'.repeat(32), 'Migration fixture', email, 1, Date.now(), Date.now());
  control.close();
  for (const file of ['founder-os.db', 'bank.db', 'ledger.db', 'paykit.db']) {
    const db = new Database(path.join(root, file));
    db.exec("CREATE TABLE example (id TEXT PRIMARY KEY, value TEXT); INSERT INTO example VALUES ('one', 'kept')"); db.close();
  }
  mkdirSync(path.join(root, 'ad-intel'));
  writeFileSync(path.join(root, 'ad-intel', 'saved.json'), '{"ads":[]}');
  writeFileSync(path.join(root, 'adpilot-campaigns.json'), '[]');
  return root;
}
function snapshot(root: string): unknown {
  return readdirSync(root, { withFileTypes: true }).map(entry => [entry.name,
    entry.isDirectory() ? snapshot(path.join(root, entry.name)) : readFileSync(path.join(root, entry.name)).toString('base64')]);
}
test('dry run leaves every file unchanged and creates no workspace', async () => {
  const root = await fixture(), before = snapshot(root);
  const result = await migrateToWorkspaces({ root, ownerEmail: email, dryRun: true });
  expect(result.status).toBe('dry-run'); expect(result.files).toHaveLength(6); expect(snapshot(root)).toEqual(before);
});
test('unknown owner cannot create an account or move any data', async () => {
  const root = await fixture(), before = snapshot(root);
  await expect(migrateToWorkspaces({ root, ownerEmail: 'missing@example.com' })).rejects.toThrow('must already exist');
  expect(snapshot(root)).toEqual(before);
});
test('verified migration preserves rows and files, owns the agency, and reruns as a no-op', async () => {
  const root = await fixture();
  const result = await migrateToWorkspaces({ root, ownerEmail: email });
  expect(result.status).toBe('complete');
  const target = path.join(root, 'workspaces', result.workspaceId!);
  for (const file of ['nosteros.db', 'bank.db', 'ledger.db', 'paykit.db']) {
    const db = new Database(path.join(target, file), { readonly: true });
    try { expect(db.prepare('SELECT * FROM example').all()).toEqual([{ id: 'one', value: 'kept' }]); } finally { db.close(); }
  }
  expect(existsSync(path.join(root, 'founder-os.db.migrated'))).toBe(true);
  expect(existsSync(path.join(root, 'founder-os.db'))).toBe(false);
  expect(readFileSync(path.join(target, 'ad-intel', 'saved.json'), 'utf8')).toBe('{"ads":[]}');
  const control = new Database(path.join(root, 'control.db'));
  try {
    expect(control.prepare('SELECT role FROM member WHERE organizationId=?').get(result.workspaceId)).toEqual({ role: 'owner' });
    expect(control.prepare('SELECT name, metadata FROM organization WHERE id=?').get(result.workspaceId)).toEqual({ name: 'nosterCodes', metadata: '{"kind":"agency"}' });
  } finally { control.close(); }
  const before = snapshot(root);
  expect((await migrateToWorkspaces({ root, ownerEmail: email })).status).toBe('already-complete');
  expect(snapshot(root)).toEqual(before);
});
test('a corrupt backup fails verification before any original is renamed', async () => {
  const root = await fixture();
  const backup = Database.prototype.backup;
  vi.spyOn(Database.prototype, 'backup').mockImplementation(async function (this: Database.Database, filename: string) {
    const result = await backup.call(this, filename);
    const corrupt = new Database(filename); corrupt.exec('DELETE FROM example'); corrupt.close(); return result;
  });
  await expect(migrateToWorkspaces({ root, ownerEmail: email })).rejects.toThrow('Row count mismatch');
  for (const file of ['founder-os.db', 'bank.db', 'ledger.db', 'paykit.db']) {
    expect(existsSync(path.join(root, file))).toBe(true); expect(existsSync(path.join(root, `${file}.migrated`))).toBe(false);
  }
});
test('an occupied target or conflicting organization is never overwritten or adopted', async () => {
  const root = await fixture();
  const control = new Database(path.join(root, 'control.db'));
  control.prepare('INSERT INTO organization (id,name,slug,createdAt,metadata) VALUES (?,?,?,?,?)')
    .run('W'.repeat(32), 'Not ours', 'nostercodes', Date.now(), '{"kind":"agency"}'); control.close();
  const before = snapshot(root);
  await expect(migrateToWorkspaces({ root, ownerEmail: email })).rejects.toThrow('not owned');
  expect(snapshot(root)).toEqual(before);
});
test('an existing owner workspace with data cannot be overwritten', async () => {
  const root = await fixture(), id = 'W'.repeat(32);
  const control = new Database(path.join(root, 'control.db'));
  control.prepare('INSERT INTO organization (id,name,slug,createdAt,metadata) VALUES (?,?,?,?,?)')
    .run(id, 'nosterCodes', 'nostercodes', Date.now(), '{"kind":"agency"}');
  control.prepare('INSERT INTO member (id,organizationId,userId,role,createdAt) VALUES (?,?,?,?,?)')
    .run('M'.repeat(32), id, 'U'.repeat(32), 'owner', Date.now()); control.close();
  mkdirSync(path.join(root, 'workspaces', id), { recursive: true });
  writeFileSync(path.join(root, 'workspaces', id, 'keep.txt'), 'do not replace');
  const before = snapshot(root);
  await expect(migrateToWorkspaces({ root, ownerEmail: email })).rejects.toThrow('will not overwrite');
  expect(snapshot(root)).toEqual(before);
});
test('migration serializes runs and refuses stale locks without removing them', async () => {
  const root = await fixture();
  writeFileSync(path.join(root, '.workspace-migration.lock'), 'another migration');
  const before = snapshot(root);
  await expect(migrateToWorkspaces({ root, ownerEmail: email })).rejects.toThrow('Migration lock');
  expect(snapshot(root)).toEqual(before);
});
test('a recreated legacy database after success is not silently ignored', async () => {
  const root = await fixture();
  await migrateToWorkspaces({ root, ownerEmail: email });
  writeFileSync(path.join(root, 'founder-os.db'), 'unexpected data');
  await expect(migrateToWorkspaces({ root, ownerEmail: email })).rejects.toThrow('Original data reappeared');
});
