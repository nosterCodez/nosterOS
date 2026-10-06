import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
const exec = promisify(execFile);
test('CLI local backup:now and backup:restore round-trip without real secrets, cloud or messages', async () => {
  const repo = process.cwd(), root = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-backup-cli-'));
  try {
    const data = path.join(root, 'data'), bucket = path.join(root, 'bucket'), restored = path.join(root, 'restored');
    await fs.mkdir(data); await fs.mkdir(bucket);
    const db = new Database(path.join(data, 'control.db'));
    db.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('CLI fixture')"); db.close();
    const env = { ...process.env, DATA_DIR: data, OMEGA_ENV: 'development', OMEGA_BACKUP_KEY: randomBytes(32).toString('base64'),
      OMEGA_BACKUP_APP_COMMIT: 'abcdef12', RAILWAY_GIT_COMMIT_SHA: '', OMEGA_OUTBOUND_DISABLED: '1' };
    const run = (script: string, args: string[]) => exec(process.execPath,
      [path.join(repo, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', path.join(repo, 'tsconfig.json'), path.join(repo, 'scripts', script), ...args],
      { cwd: root, env, timeout: 20_000 });
    const backup = await run('backup-now.ts', ['--local-dir', bucket]);
    expect(backup.stdout).toContain('success');
    const archives = await fs.readdir(bucket); expect(archives).toHaveLength(1);
    const restore = await run('backup-restore.ts', ['--local-dir', bucket, '--archive', archives[0], '--to', restored]);
    expect(restore.stdout).toContain('files');
    const recovered = new Database(path.join(restored, 'control.db'), { readonly: true });
    try { expect(recovered.prepare('SELECT value FROM fixture').pluck().get()).toBe('CLI fixture'); } finally { recovered.close(); }
    await expect(run('backup-restore.ts', ['--local-dir', bucket, '--archive', archives[0], '--to', restored])).rejects.toThrow();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
