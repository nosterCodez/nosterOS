import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from '@/lib/paths';
import { openDb } from '@/lib/db';
import { openBankStore } from '@/lib/bank';
import { openLedger } from '@/lib/ledger';
import { openPaykitHistory } from '@/lib/paykit-history';
import { seedStructure, seedDemo, SEED_VERSION } from '@/lib/seed';
import { HandlePool } from '@/lib/handle-pool';

function directory(id: string): string {
  const dir = workspaceDir(id);
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  return dir;
}
const app = new HandlePool((dir: string) => {
  const db = openDb(path.join(/*turbopackIgnore: true*/ dir, 'nosteros.db'));
  if (db.meta.get('structure_seed_version') !== SEED_VERSION) seedStructure(db);
  if (process.env.DEMO_GATE === '1' && db.meta.get('seed_version') !== SEED_VERSION) seedDemo(db);
  return db;
});
const banks = new HandlePool((dir: string) => openBankStore(path.join(/*turbopackIgnore: true*/ dir, 'bank.db')));
const ledgers = new HandlePool((dir: string) => openLedger(path.join(/*turbopackIgnore: true*/ dir, 'ledger.db')));
const paykits = new HandlePool((key: string) => {
  const [dir, account] = JSON.parse(key) as [string, string];
  return openPaykitHistory(account, path.join(/*turbopackIgnore: true*/ dir, 'paykit.db'), process.env.DEMO_GATE === '1');
});
export function openWorkspaceDb(id: string) { return app.get(directory(id)); }
export function openWorkspaceBank(id: string) { return banks.get(directory(id)); }
export function openWorkspaceLedger(id: string) { return ledgers.get(directory(id)); }
export function openWorkspacePaykit(id: string, account: string) { return paykits.get(JSON.stringify([directory(id), account])); }
export function withWorkspaceDb<R>(id: string, work: (db: ReturnType<typeof openDb>) => R | Promise<R>) { return app.withHandle(directory(id), work); }
export function withWorkspaceBank<R>(id: string, work: (db: ReturnType<typeof openBankStore>) => R | Promise<R>) { return banks.withHandle(directory(id), work); }
export function withWorkspaceLedger<R>(id: string, work: (db: ReturnType<typeof openLedger>) => R | Promise<R>) { return ledgers.withHandle(directory(id), work); }
export function withWorkspacePaykit<R>(id: string, account: string, work: (db: ReturnType<typeof openPaykitHistory>) => R | Promise<R>) { return paykits.withHandle(JSON.stringify([directory(id), account]), work); }
export function closeWorkspaceStores() { app.closeAll(); banks.closeAll(); ledgers.closeAll(); paykits.closeAll(); }
