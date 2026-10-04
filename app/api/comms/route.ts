import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { gatherCommsFeed } from '@/lib/comms-feed';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/comms', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  const feed = await gatherCommsFeed();
  return NextResponse.json({ feed });
}
