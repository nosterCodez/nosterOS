import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace } from '@/lib/session';
import { COLLECTORS } from '@/lib/collectors';
import { collectorHealth } from '@/lib/collectors/run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  const authError = await apiSessionError('/api/collectors', 'GET');
  if (authError) return authError;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  const now = new Date();
  return NextResponse.json(await Promise.all(COLLECTORS.map(async collector => {
    let status;
    try { status = await collector.status(); }
    catch (error) { status = { id: collector.id, name: collector.name, state: 'error', detail: error instanceof Error ? error.message : String(error) }; }
    return { id: collector.id, name: collector.name, everyMinutes: collector.everyMinutes, status, ...collectorHealth(collector, workspace.db, now) };
  })));
}
