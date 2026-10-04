import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { VENTURES } from '@/lib/ventures';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/ventures', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  return NextResponse.json({ ventures: VENTURES });
}
