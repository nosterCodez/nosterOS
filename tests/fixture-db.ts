import fs from 'node:fs';
import path from 'node:path';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDemoFixture } from './demo-fixture';

let instance: FounderDb | undefined;
/** Legacy single-workspace business-logic fixture; never imported by app code. */
export function getDb(): FounderDb {
  if (instance) return instance;
  const file = process.env.FOUNDER_OS_DB ?? ':memory:';
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  instance = openDb(file); seedDemoFixture(instance); return instance;
}
