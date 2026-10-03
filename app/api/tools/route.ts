import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/tools', 'GET');
  if (authError) return authError;

  const db = getDb();
  return NextResponse.json({ tools: db.tools.all() });
}
