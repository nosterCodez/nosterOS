import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { zernioRecentPosts } from '@/lib/connectors/zernio';

export const dynamic = 'force-dynamic';

/** Live published-post history from Zernio/Late (real captions + post URLs).
    Distinct from /api/social/posts, which is the outgoing publish queue.
    `?limit=` caps the count. */
export async function GET(req: Request) {
  const authError = await apiSessionError('/api/social/history', 'GET', req);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(req.headers);
  if (operatorAccess instanceof Response) return operatorAccess;

  const limit = Number(new URL(req.url).searchParams.get('limit')) || 6;
  const posts = await zernioRecentPosts(Math.min(Math.max(limit, 1), 24));
  return NextResponse.json({ posts });
}
