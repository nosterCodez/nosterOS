import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { apiWorkspace } from '@/lib/session';
import { platformDetail, syncFromZernioConfig } from '@/lib/social';
import type { SocialPlatform } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, props: { params: Promise<{ platform: string }> }) {
  const authError = await apiSessionError('/api/social/[platform]', 'GET', _req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(_req.headers);
  if (operatorAccess instanceof Response) return operatorAccess;
  const workspace = await apiWorkspace(_req.headers);
  if (workspace instanceof Response) return workspace;


  const params = await props.params;
  const db = workspace.db;
  syncFromZernioConfig(db);
  const detail = platformDetail(db, params.platform as SocialPlatform);
  if (!detail) {
    return NextResponse.json({ error: `unknown platform: ${params.platform}` }, { status: 404 });
  }
  return NextResponse.json(detail);
}
