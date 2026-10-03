import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { readBrainSatellites } from '@/lib/brain-satellites';

export const dynamic = 'force-dynamic';

/** The facts the G-Brain satellites show: pages, folders, clusters, freshness, provider status. */
export async function GET() {
  const authError = await apiSessionError('/api/brain/satellites', 'GET');
  if (authError) return authError;

  return NextResponse.json(await readBrainSatellites());
}
