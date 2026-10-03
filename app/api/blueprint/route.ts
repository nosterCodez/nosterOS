import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace } from '@/lib/session';
import { compileBlueprint } from '@/lib/blueprint/compile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const authError = await apiSessionError('/api/blueprint', 'GET');
  if (authError) return authError;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  const graph = await compileBlueprint(workspace.db);
  return NextResponse.json({ ok: true, graph });
}
