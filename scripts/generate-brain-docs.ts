/**
 * Generate the brain-store markdown for the whole org: agents, SOPs, tools,
 * people, pillars — wikilinked so the G-Brain constellation gains real
 * structure. Hand-edited files (no generated marker) are never touched.
 *
 *   npm run brain:docs -- --workspace <existing workspace ID>
 */
import { maintenanceTarget } from '../lib/workspace-maintenance';
import { openDb } from '@/lib/db';
import { seedStructure, seedDemo } from '@/lib/seed';
import { buildBrainDocs, writeBrainDocs } from '@/lib/brain-docs';

const { dbPath, brainRoot: root } = maintenanceTarget(process.argv.slice(2));
const db = openDb(dbPath);
seedStructure(db);
if (process.env.DEMO_GATE === '1') seedDemo(db);

const docs = buildBrainDocs({
  departments: db.departments.all(),
  agents: db.agents.all(),
  people: db.people.all(),
  tasks: db.sopTasks.all(),
  tools: db.tools.all(),
});

const { written, skipped } = writeBrainDocs(docs, root);
db.close();

console.log(`brain-docs → ${root}`);
console.log(`  written: ${written}`);
console.log(`  skipped (hand-edited): ${skipped}`);
console.log(`  total docs: ${docs.length}`);
