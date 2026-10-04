import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { maintenanceTarget } from '@/lib/workspace-maintenance';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
test('maintenance requires an explicit existing workspace and ignores legacy overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nosteros-maintenance-')); roots.push(root);
  const db = new Database(path.join(root, 'control.db'));
  const id = 'A'.repeat(32);
  db.exec('CREATE TABLE organization (id TEXT PRIMARY KEY)'); db.prepare('INSERT INTO organization VALUES (?)').run(id); db.close();
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DATA_DIR: root, NOSTEROS_DB: 'do-not-use.db', GBRAIN_STORE: 'do-not-use', BRAIN_DOCS_DIR: 'do-not-use' };
  expect(() => maintenanceTarget([], env)).toThrow('explicit');
  expect(() => maintenanceTarget(['--workspace', '../'], env)).toThrow('Invalid');
  expect(() => maintenanceTarget(['--workspace', 'B'.repeat(32)], env)).toThrow('does not exist');
  expect(() => maintenanceTarget(['--workspace', id], env)).toThrow('initialized');
  const dir = path.join(root, 'workspaces', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'nosteros.db'), 'not opened by target resolver');
  expect(maintenanceTarget(['--workspace', id], env)).toEqual({ id, dbPath: path.join(dir, 'nosteros.db'), brainRoot: path.join(dir, 'brain-store') });
  expect(fs.existsSync(path.join(root, 'founder-os.db'))).toBe(false);
});
