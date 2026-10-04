import { maintenanceTarget } from '../lib/workspace-maintenance';
import { openDb } from '../lib/db';
import { seedStructure, seedDemo } from '../lib/seed';

const { dbPath } = maintenanceTarget(process.argv.slice(2));
const db = openDb(dbPath);
seedStructure(db);
if (process.env.DEMO_GATE === '1') seedDemo(db);
console.log(`Seeded ${dbPath}`);
console.log(`  departments: ${db.departments.all().length}`);
console.log(`  agents:      ${db.agents.all().length}`);
console.log(`  tools:       ${db.tools.all().length}`);
console.log(`  roadmap:     ${db.roadmap.all().length}`);
db.close();
