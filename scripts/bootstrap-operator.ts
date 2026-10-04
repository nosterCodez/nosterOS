import fs from 'node:fs';
import { dataDir } from '../lib/paths';
import { bootstrapOperator } from '../lib/operator-bootstrap';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--adopt-workspace')) throw new Error('Usage: bootstrap-operator [--adopt-workspace <exact workspace ID>]. Configure DATA_DIR and NOSTEROS_OWNER_EMAIL in the server environment.');
  const result = bootstrapOperator({ root: dataDir(), ownerEmail: process.env.NOSTEROS_OWNER_EMAIL ?? '', demo: process.env.DEMO_GATE === '1', adoptWorkspaceId: args[1] });
  console.log(JSON.stringify(result));
  console.log('Refresh the app and select the nosterCodes workspace. No connectors were configured.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operator bootstrap failed');
  process.exitCode = 1;
}
