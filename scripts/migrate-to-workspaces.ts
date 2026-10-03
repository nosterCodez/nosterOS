import fs from 'node:fs';
import { dataDir } from '../lib/paths';
import { migrateToWorkspaces } from '../lib/workspace-migration';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--server-stopped'].includes(arg))) throw new Error('Supported options: --dry-run, --server-stopped');
  const dryRun = args.includes('--dry-run');
  if (!dryRun && !args.includes('--server-stopped')) throw new Error('Stop the app and background jobs, then pass --server-stopped. Test on a copy first.');
  for (const key of ['FOUNDER_OS_DB', 'BANK_DB', 'LEDGER_DB', 'PAYKIT_DB', 'ADSCOUT_STORE_DIR', 'ADPILOT_DATA_PATH']) {
    if (process.env[key]) throw new Error(`${key} overrides the default data layout. Consolidate a verified copy under DATA_DIR before migration.`);
  }
  const result = await migrateToWorkspaces({ root: dataDir(), ownerEmail: process.env.NOSTEROS_OWNER_EMAIL ?? '', dryRun });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });
