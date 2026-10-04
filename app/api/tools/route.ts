import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/tools', 'GET');
  if (authError) return authError;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  const db = workspace.db;
  return NextResponse.json({ tools: db.tools.all() });
}
