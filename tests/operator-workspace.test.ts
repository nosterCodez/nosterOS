import { afterEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { operatorWorkspaceId } from '@/lib/operator-workspace';
import { requireOperatorWorkspace, apiOperatorWorkspace } from '@/lib/session';

vi.unmock('@/lib/session');
const mocks = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), organization: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: mocks.session, getActiveMember: mocks.member, getFullOrganization: mocks.organization } }) }));
vi.mock('@/lib/workspace-storage', () => ({ openWorkspaceDb: mocks.open }));
const A = 'A'.repeat(32), B = 'B'.repeat(32), owner = 'owner@example.com';
const headers = new Headers({ cookie: 'better-auth.session_token=test' });
let root: string, db: Database.Database;
function setup() {
  vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', '1');
  root = mkdtempSync(path.join(tmpdir(), 'operator-gate-')); vi.stubEnv('DATA_DIR', root); vi.stubEnv('NOSTEROS_OWNER_EMAIL', owner);
  db = new Database(path.join(root, 'control.db'));
  db.exec(`CREATE TABLE organization(id TEXT,metadata TEXT); CREATE TABLE user(id TEXT,email TEXT);
    CREATE TABLE member(organizationId TEXT,userId TEXT,role TEXT);
    CREATE TABLE nosteros_operator(id INTEGER PRIMARY KEY,organizationId TEXT,ownerUserId TEXT);`);
  db.prepare('INSERT INTO organization VALUES (?,?)').run(A, '{"kind":"agency"}');
  db.prepare('INSERT INTO user VALUES (?,?)').run('owner', owner);
  db.prepare('INSERT INTO member VALUES (?,?,?)').run(A, 'owner', 'owner');
  mocks.session.mockResolvedValue({ user: { id: 'member', email: 'member@example.com', name: 'Member' }, session: { activeOrganizationId: A } });
  mocks.member.mockResolvedValue({ role: 'member', organizationId: A, userId: 'member' });
  mocks.organization.mockResolvedValue({ id: A, name: 'nosterCodes', metadata: { kind: 'agency' } });
}
afterEach(() => { db?.close(); if(root) rmSync(root,{recursive:true,force:true}); vi.unstubAllEnvs(); vi.resetAllMocks(); });
test('name, slug, owner and agency metadata alone cannot grant operator access', async () => {
  setup();
  expect(operatorWorkspaceId()).toBeNull();
  expect((await apiOperatorWorkspace(headers) as Response).status).toBe(403);
  db.prepare('INSERT INTO nosteros_operator VALUES (1,?,?)').run(A, 'owner');
  expect(operatorWorkspaceId()).toBe(A);
  expect((await requireOperatorWorkspace(headers,'api')).workspace.id).toBe(A);
  mocks.session.mockResolvedValue({ session: { activeOrganizationId: B } });
  mocks.organization.mockResolvedValue({ id: B, name: 'nosterCodes', metadata: { kind: 'agency' } });
  expect((await apiOperatorWorkspace(headers) as Response).status).toBe(403);
});
test('missing or changed configured owner, membership or metadata fails closed', () => {
  setup(); db.prepare('INSERT INTO nosteros_operator VALUES (1,?,?)').run(A, 'owner');
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', 'different@example.com'); expect(operatorWorkspaceId()).toBeNull();
  vi.stubEnv('NOSTEROS_OWNER_EMAIL', owner);
  db.exec("UPDATE member SET role='admin'"); expect(operatorWorkspaceId()).toBeNull();
  db.exec("UPDATE member SET role='owner'; UPDATE organization SET metadata='broken'"); expect(operatorWorkspaceId()).toBeNull();
});
test('unauthenticated requests cannot use the operator binding', async () => {
  setup(); db.prepare('INSERT INTO nosteros_operator VALUES (1,?,?)').run(A, 'owner');
  mocks.session.mockResolvedValue(null);
  expect((await apiOperatorWorkspace(headers) as Response).status).toBe(401);
  expect(mocks.open).not.toHaveBeenCalled();
});
test('operator binding alone cannot enable host features', async () => {
  setup(); db.prepare('INSERT INTO nosteros_operator VALUES (1,?,?)').run(A, 'owner');
  vi.stubEnv('NOSTEROS_OPERATOR_FEATURES', '');
  expect((await apiOperatorWorkspace(headers) as Response).status).toBe(403);
  expect(mocks.open).not.toHaveBeenCalled();
});
