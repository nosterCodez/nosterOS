import fs from 'node:fs';
import { dataDir } from '../lib/paths';
import { bootstrapOperator } from '../lib/operator-bootstrap';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
try {
  if (process.argv.length > 2) throw new Error('Configure DATA_DIR and NOSTEROS_OWNER_EMAIL in the server environment; no arguments are accepted');
  const result = bootstrapOperator({ root: dataDir(), ownerEmail: process.env.NOSTEROS_OWNER_EMAIL ?? '', demo: process.env.DEMO_GATE === '1' });
  console.log(JSON.stringify(result));
  console.log('Refresh the app and select the nosterCodes workspace. No connectors were configured.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operator bootstrap failed');
  process.exitCode = 1;
}
