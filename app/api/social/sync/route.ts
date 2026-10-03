import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { syncFromZernioLive } from '@/lib/social-live';
import { zernioLiveAccounts } from '@/lib/connectors/zernio';

export const dynamic = 'force-dynamic';

/** Force a live follower-count sync from Zernio/Late and report what landed.
    GET and POST both work so it's trivial to trigger from a browser or curl. */
async function runSync() {
  const db = getDb();
  const accounts = await zernioLiveAccounts();
  const recorded = await syncFromZernioLive(db, { source: async () => accounts });
  return NextResponse.json({
    ok: true,
    recorded,
    syncedAt: new Date().toISOString(),
    source: Object.keys(accounts).length > 0 ? 'zernio-live' : 'config-fallback',
    accounts,
  });
}

export async function POST() {
  const authError = await apiSessionError('/api/social/sync', 'POST');
  if (authError) return authError;

  return runSync();
}

export async function GET() {
  const authError = await apiSessionError('/api/social/sync', 'GET');
  if (authError) return authError;

  return runSync();
}
