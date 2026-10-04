import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace, withWorkspaceLease } from '@/lib/session';
import { ingestPlaudNow } from '@/lib/plaud-ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Plaud → knowledge base, on demand. GET lists what has been filed; POST runs
 * one ingest pass (the same pass the Sales Calls Data agent and its 30-minute
 * cron run). Pure code, no LLM: Plaud's transcript + AI note are filed as-is.
 */
export async function GET() {
  const authError = await apiSessionError('/api/plaud/ingest', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  const rows = workspace.db.plaudIngests.all();
  return NextResponse.json({ ingested: rows.length, rows }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST() {
  const authError = await apiSessionError('/api/plaud/ingest', 'POST');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  const result = await withWorkspaceLease(workspace, db => ingestPlaudNow(db));
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
