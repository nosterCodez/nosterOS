import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { createGBrainProvider } from '@/lib/connectors/gbrain';
import { BrainOverviewSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/brain/overview', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  const overview = await createGBrainProvider().overview();
  return NextResponse.json(BrainOverviewSchema.parse(overview));
}
