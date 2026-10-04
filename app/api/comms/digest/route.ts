import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace, withWorkspaceLease } from '@/lib/session';
import { runAndStoreCommsDigest } from '@/lib/comms-digest-run';
import type { DigestRunResult } from '@/lib/comms-digest-run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The morning comms report. GET returns the stored one (the 9am cron writes
 * it, so opening /comms is instant rather than re-scraping six connectors);
 * POST regenerates on demand for the "run now" button.
 */
export async function GET() {
  const authError = await apiSessionError('/api/comms/digest', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  const row = workspace.db.commsDigests.latest();
  if (!row) return NextResponse.json({ digest: null, sources: [], generatedAt: null });
  try {
    const parsed = JSON.parse(row.payload) as DigestRunResult;
    return NextResponse.json({ ...parsed, generatedAt: row.generatedAt });
  } catch {
    return NextResponse.json({ digest: null, sources: [], generatedAt: row.generatedAt });
  }
}

export async function POST() {
  const authError = await apiSessionError('/api/comms/digest', 'POST');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  try {
    const result = await withWorkspaceLease(workspace, db => runAndStoreCommsDigest(db));
    return NextResponse.json({ ...result, generatedAt: result.digest.generatedAt });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
