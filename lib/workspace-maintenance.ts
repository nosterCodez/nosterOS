import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { controlDbPath, workspaceDir } from './paths';

/** Administrative CLI targets must already exist in the control plane. */
export function maintenanceTarget(args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (args.length !== 2 || args[0] !== '--workspace') throw new Error('An explicit --workspace <id> is required');
  const id = args[1];
  const dir = workspaceDir(id, env);
  const control = new Database(controlDbPath(env), { readonly: true, fileMustExist: true });
  try {
    if (!control.prepare('SELECT id FROM organization WHERE id=?').get(id)) throw new Error('Workspace does not exist');
  } finally { control.close(); }
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) throw new Error('Workspace must be initialized and not a symbolic link');
  const dbPath = path.join(dir, 'nosteros.db');
  if (!fs.existsSync(dbPath) || fs.lstatSync(dbPath).isSymbolicLink()) throw new Error('Workspace database must exist and not be a symbolic link');
  const brainRoot = path.join(dir, 'brain-store');
  if (fs.existsSync(brainRoot) && fs.lstatSync(brainRoot).isSymbolicLink()) throw new Error('Brain directory must not be a symbolic link');
  return { id, dbPath, brainRoot };
}
