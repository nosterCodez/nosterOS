import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';

/** Administrative fresh-install command, never exposed through an HTTP route. */
export function bootstrapOperator(options: { root: string; ownerEmail: string; demo?: boolean; adoptWorkspaceId?: string }) {
  const ownerEmail = z.string().email().parse(options.ownerEmail.trim().toLowerCase());
  const adoptId = options.adoptWorkspaceId === undefined ? undefined : z.string().regex(/^[A-Za-z0-9]{32}$/).parse(options.adoptWorkspaceId);
  if (options.demo) throw new Error('Fresh operator bootstrap requires DEMO_GATE disabled');
  const root = fs.realpathSync(options.root);
  for (const name of ['founder-os.db', 'bank.db', 'ledger.db', 'paykit.db', 'ad-intel', 'adpilot-campaigns.json', 'workspace-migration.json', '.workspace-migration.lock']) {
    if (fs.existsSync(path.join(root, name)) || fs.existsSync(path.join(root, name + '.migrated'))) throw new Error('Legacy data detected; use the migration workflow on a verified copy instead');
  }
  const file = path.join(root, 'control.db');
  if (!fs.existsSync(file)) throw new Error('Owner must sign in before operator bootstrap');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Bootstrap refuses a linked control database');
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    return db.transaction(() => {
      const owner = db.prepare('SELECT id,emailVerified FROM user WHERE lower(email)=?').get(ownerEmail) as { id: string; emailVerified: number } | undefined;
      if (!owner || owner.emailVerified !== 1) throw new Error('Configured owner must complete verified sign-in before bootstrap');
      const hasBinding = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nosteros_operator'").get();
      if (hasBinding) {
        const binding = db.prepare('SELECT organizationId,ownerUserId FROM nosteros_operator WHERE id=1').get() as { organizationId: string; ownerUserId: string } | undefined;
        if (binding) {
          if (adoptId && adoptId !== binding.organizationId) throw new Error('Requested adoption conflicts with existing operator binding');
          const workspace = db.prepare('SELECT metadata FROM organization WHERE id=?').get(binding.organizationId) as { metadata: string } | undefined;
          const member = db.prepare("SELECT id FROM member WHERE organizationId=? AND userId=? AND role='owner'").get(binding.organizationId, owner.id);
          if (binding.ownerUserId !== owner.id || !/^[A-Za-z0-9]{32}$/.test(binding.organizationId) || !workspace || JSON.parse(workspace.metadata).kind !== 'agency' || !member) throw new Error('Existing operator binding conflicts with configured owner; no changes made');
          return { status: 'already-complete' as const, workspaceId: binding.organizationId };
        }
      }
      if (adoptId) {
        const workspace = db.prepare('SELECT name,metadata FROM organization WHERE id=?').get(adoptId) as { name: string; metadata: string } | undefined;
        let metadata: Record<string, unknown> | undefined;
        try { metadata = JSON.parse(workspace?.metadata ?? 'null'); } catch { /* Invalid metadata is rejected below. */ }
        if (!workspace || workspace.name !== 'nosterCodes' || !metadata || Array.isArray(metadata) || !['founder', 'agency'].includes(String(metadata.kind))) throw new Error('Workspace is not eligible for operator adoption');
        const members = db.prepare('SELECT userId,role FROM member WHERE organizationId=?').all(adoptId) as { userId: string; role: string }[];
        if (members.length !== 1 || members[0].userId !== owner.id || members[0].role !== 'owner') throw new Error('Adoption requires the configured owner to be the sole workspace member');
        if (db.prepare("SELECT id FROM invitation WHERE organizationId=? AND status='pending'").get(adoptId)) throw new Error('Adoption refuses pending invitations');
        if (db.prepare("SELECT id FROM organization WHERE id<>? AND (name='nosterCodes' OR slug='nostercodes')").get(adoptId)) throw new Error('Operator workspace name is ambiguous');
        db.prepare('UPDATE organization SET metadata=? WHERE id=?').run(JSON.stringify({ ...metadata, kind: 'agency' }), adoptId);
        db.exec('CREATE TABLE IF NOT EXISTS nosteros_operator (id INTEGER PRIMARY KEY CHECK(id=1), organizationId TEXT NOT NULL, ownerUserId TEXT NOT NULL)');
        db.prepare('INSERT INTO nosteros_operator VALUES (1,?,?)').run(adoptId, owner.id);
        return { status: 'adopted' as const, workspaceId: adoptId };
      }
      if (db.prepare("SELECT id FROM organization WHERE slug='nostercodes' OR name='nosterCodes'").get()) throw new Error('Existing nosterCodes workspace has no operator binding; inspect before proceeding');
      const id = randomBytes(16).toString('hex');
      if (fs.existsSync(path.join(root, 'workspaces', id))) throw new Error('Workspace directory already exists; no changes made');
      db.prepare('INSERT INTO organization (id,name,slug,createdAt,metadata) VALUES (?,?,?,?,?)')
        .run(id, 'nosterCodes', 'nostercodes', Date.now(), '{"kind":"agency"}');
      db.prepare('INSERT INTO member (id,organizationId,userId,role,createdAt) VALUES (?,?,?,?,?)')
        .run(randomBytes(16).toString('hex'), id, owner.id, 'owner', Date.now());
      db.exec('CREATE TABLE IF NOT EXISTS nosteros_operator (id INTEGER PRIMARY KEY CHECK(id=1), organizationId TEXT NOT NULL, ownerUserId TEXT NOT NULL)');
      db.prepare('INSERT INTO nosteros_operator VALUES (1,?,?)').run(id, owner.id);
      return { status: 'created' as const, workspaceId: id };
    }).immediate();
  } finally { db.close(); }
}
