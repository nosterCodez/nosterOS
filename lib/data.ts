import type { FounderDb } from '@/lib/db';

/** Explicit context only. There is no shared database or default workspace. */
export function getDb(context: { db: FounderDb }): FounderDb {
  if (!context?.db) throw new Error('Workspace context required');
  return context.db;
}
