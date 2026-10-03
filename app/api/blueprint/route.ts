import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { compileBlueprint } from '@/lib/blueprint/compile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const authError = await apiSessionError('/api/blueprint', 'GET');
  if (authError) return authError;

  const graph = await compileBlueprint(getDb());
  return NextResponse.json({ ok: true, graph });
}
