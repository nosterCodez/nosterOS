import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { platformDetail, syncFromZernioConfig } from '@/lib/social';
import type { SocialPlatform } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, props: { params: Promise<{ platform: string }> }) {
  const authError = await apiSessionError('/api/social/[platform]', 'GET', _req);
  if (authError) return authError;

  const params = await props.params;
  const db = getDb();
  syncFromZernioConfig(db);
  const detail = platformDetail(db, params.platform as SocialPlatform);
  if (!detail) {
    return NextResponse.json({ error: `unknown platform: ${params.platform}` }, { status: 404 });
  }
  return NextResponse.json(detail);
}
