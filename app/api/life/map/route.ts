import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { buildLifeMap } from '@/lib/life-map';
import { LifeMapSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/life/map', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  return NextResponse.json(LifeMapSchema.parse(buildLifeMap()));
}
