import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { workspaceDir } from '@/lib/paths';

const artifacts = [
  ['founder-os.db', 'nosteros.db'], ['bank.db', 'bank.db'], ['ledger.db', 'ledger.db'],
  ['paykit.db', 'paykit.db'], ['ad-intel', 'ad-intel'], ['adpilot-campaigns.json', 'adpilot-campaigns.json'],
] as const;
const manifestSchema = z.object({
  version: z.literal(1), workspaceId: z.string().regex(/^[A-Za-z0-9]{32}$/), ownerEmail: z.string().email(),
  files: z.array(z.enum(['founder-os.db', 'bank.db', 'ledger.db', 'paykit.db', 'ad-intel', 'adpilot-campaigns.json'])),
  state: z.enum(['verified', 'complete']),
});
type Result = { status: 'dry-run' | 'complete' | 'already-complete'; workspaceId?: string; files: string[] };
type Options = { root: string; ownerEmail: string; dryRun?: boolean };
const randomId = () => randomBytes(16).toString('hex');
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

function tableCounts(db: Database.Database) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, (db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get() as { n: number }).n]));
}
function verifyDatabase(source: string, target: string) {
  const a = new Database(source, { readonly: true, fileMustExist: true });
  let b: Database.Database | undefined;
  try {
    b = new Database(target, { readonly: true, fileMustExist: true });
    if (b.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error(`Integrity check failed: ${path.basename(target)}`);
    if (JSON.stringify(tableCounts(a)) !== JSON.stringify(tableCounts(b))) throw new Error(`Row count mismatch: ${path.basename(source)}`);
  } finally { b?.close(); a.close(); }
}
function treeHash(file: string): string {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Migration refuses symbolic links');
  if (stat.isDirectory()) return createHash('sha256').update(JSON.stringify(fs.readdirSync(file).sort().map(name => [name, treeHash(path.join(file, name))]))).digest('hex');
  if (!stat.isFile()) throw new Error('Migration only supports regular files and directories');
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function verifyArtifact(source: string, target: string, database: boolean) {
  if (database) verifyDatabase(source, target);
  else if (treeHash(source) !== treeHash(target)) throw new Error(`File verification failed: ${path.basename(source)}`);
}

/** Offline migration only: stop app/jobs first. Partial copies are retained, never overwritten. */
export async function migrateToWorkspaces(options: Options): Promise<Result> {
  if (options.dryRun) return migrateUnlocked(options);
  const lock = path.join(fs.realpathSync(options.root), '.workspace-migration.lock');
  let fd: number;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch { throw new Error('Migration lock exists or cannot be created. Stop concurrent migration; inspect stale locks before recovery.'); }
  try { return await migrateUnlocked(options); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
async function migrateUnlocked(options: Options): Promise<Result> {
  const root = fs.realpathSync(options.root);
  const ownerEmail = z.string().email().parse(options.ownerEmail).trim().toLowerCase();
  const controlPath = path.join(root, 'control.db');
  if (!fs.existsSync(controlPath)) throw new Error('Owner account must already exist: sign in before migration');
  if (fs.lstatSync(controlPath).isSymbolicLink()) throw new Error('Migration refuses symbolic links');
  const control = new Database(controlPath, { readonly: true, fileMustExist: true });
  let ownerId: string;
  let workspaceId: string | undefined;
  try {
    const owner = control.prepare('SELECT id FROM user WHERE lower(email)=?').get(ownerEmail) as { id: string } | undefined;
    if (!owner) throw new Error('Owner account must already exist: sign in before migration');
    ownerId = owner.id;
    if (control.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nosteros_operator'").get()) {
      const binding = control.prepare('SELECT organizationId,ownerUserId FROM nosteros_operator WHERE id=1').get() as { organizationId: string; ownerUserId: string } | undefined;
      const expected = control.prepare("SELECT id FROM organization WHERE slug='nostercodes'").get() as { id: string } | undefined;
      if (binding && (binding.organizationId !== expected?.id || binding.ownerUserId !== ownerId)) throw new Error('Operator binding conflict; no data changed');
    }
    const workspace = control.prepare("SELECT id, name, metadata FROM organization WHERE slug='nostercodes'").get() as { id: string; name: string; metadata: string } | undefined;
    if (workspace) {
      const member = control.prepare('SELECT role FROM member WHERE organizationId=? AND userId=?').get(workspace.id, ownerId) as { role: string } | undefined;
      if (!member?.role.split(',').includes('owner')) throw new Error('Existing nosterCodes workspace is not owned by the configured account');
      if (workspace.name !== 'nosterCodes' || JSON.parse(workspace.metadata).kind !== 'agency') throw new Error('Existing workspace does not match nosterCodes agency');
      workspaceId = workspace.id;
      workspaceDir(workspaceId, { DATA_DIR: root });
    }
  } finally { control.close(); }

  const manifestPath = path.join(root, 'workspace-migration.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    if (manifest.ownerEmail !== ownerEmail || manifest.workspaceId !== workspaceId) throw new Error('Migration manifest ownership mismatch');
    const target = workspaceDir(manifest.workspaceId, { DATA_DIR: root });
    if (manifest.state !== 'complete') throw new Error('Interrupted migration: verified copies retained; inspect originals and manifest before recovery');
    for (const [source, destination] of artifacts.filter(([name]) => manifest.files.includes(name))) {
      if (fs.existsSync(path.join(root, source))) throw new Error('Original data reappeared after migration; refusing to overwrite either copy');
      if (!fs.existsSync(path.join(target, destination)) || !fs.existsSync(path.join(root, `${source}.migrated`))) throw new Error('Completed migration is missing a preserved file');
    }
    return { status: 'already-complete', workspaceId, files: manifest.files };
  }
  const files = artifacts.filter(([name]) => fs.existsSync(path.join(root, name)));
  if (!files.some(([name]) => name === 'founder-os.db')) throw new Error('No founder-os.db to migrate');
  for (const [name] of files) {
    treeHash(path.join(root, name));
    if (fs.existsSync(path.join(root, `${name}.migrated`))) throw new Error(`Preserved original already exists: ${name}.migrated`);
  }
  const id = workspaceId ?? randomId();
  const target = workspaceDir(id, { DATA_DIR: root });
  if (fs.existsSync(path.dirname(target)) && fs.lstatSync(path.dirname(target)).isSymbolicLink()) throw new Error('Migration refuses symbolic links');
  if (fs.existsSync(target)) throw new Error('Workspace target already exists; migration will not overwrite it');
  if (options.dryRun) return { status: 'dry-run', workspaceId, files: files.map(([name]) => name) };

  fs.mkdirSync(target, { recursive: true });
  for (const [source, destination] of files) {
    const from = path.join(root, source), to = path.join(target, destination);
    if (source.endsWith('.db')) {
      const db = new Database(from, { readonly: true, fileMustExist: true });
      try { await db.backup(to); } finally { db.close(); }
    } else fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    verifyArtifact(from, to, source.endsWith('.db'));
  }
  // Check every copy again before renaming any original, and require idle WALs.
  for (const [source, destination] of files) {
    const from = path.join(root, source);
    if (source.endsWith('.db')) {
      const db = new Database(from, { fileMustExist: true });
      try {
        const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
        if (checkpoint.some(row => row.busy !== 0)) throw new Error('Database busy: stop the app and background jobs before migration');
      } finally { db.close(); }
    }
    verifyArtifact(from, path.join(target, destination), source.endsWith('.db'));
  }
  if (!workspaceId) {
    const writable = new Database(controlPath, { fileMustExist: true });
    try {
      writable.pragma('foreign_keys = ON');
      writable.transaction(() => {
        writable.prepare('INSERT INTO organization (id,name,slug,createdAt,metadata) VALUES (?,?,?,?,?)')
          .run(id, 'nosterCodes', 'nostercodes', Date.now(), JSON.stringify({ kind: 'agency' }));
        writable.prepare('INSERT INTO member (id,organizationId,userId,role,createdAt) VALUES (?,?,?,?,?)')
          .run(randomId(), id, ownerId, 'owner', Date.now());
      })();
    } finally { writable.close(); }
  }
  const manifest = { version: 1 as const, workspaceId: id, ownerEmail, files: files.map(([name]) => name), state: 'verified' as 'verified' | 'complete' };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  for (const [source] of files) {
    fs.renameSync(path.join(root, source), path.join(root, `${source}.migrated`));
    if (source.endsWith('.db')) for (const suffix of ['-wal', '-shm']) {
      const sidecar = path.join(root, `${source}${suffix}`);
      if (fs.existsSync(sidecar)) fs.renameSync(sidecar, path.join(root, `${source}.migrated${suffix}`));
    }
  }
  manifest.state = 'complete';
  const binding = new Database(controlPath, { fileMustExist: true });
  try {
    binding.exec('CREATE TABLE IF NOT EXISTS nosteros_operator (id INTEGER PRIMARY KEY CHECK(id=1), organizationId TEXT NOT NULL, ownerUserId TEXT NOT NULL)');
    const existing = binding.prepare('SELECT organizationId,ownerUserId FROM nosteros_operator WHERE id=1').get() as { organizationId: string; ownerUserId: string } | undefined;
    if (existing && (existing.organizationId !== id || existing.ownerUserId !== ownerId)) throw new Error('Operator binding conflict; inspect migration before continuing');
    binding.prepare('INSERT OR IGNORE INTO nosteros_operator VALUES (1,?,?)').run(id, ownerId);
  } finally { binding.close(); }
  fs.writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  fs.renameSync(`${manifestPath}.tmp`, manifestPath);
  return { status: 'complete', workspaceId: id, files: manifest.files };
}
