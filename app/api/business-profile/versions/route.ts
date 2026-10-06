import { apiSessionError } from '@/lib/session';
import { businessProfileRequest } from '@/lib/business-profile/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { const denied = await apiSessionError('/api/business-profile/versions', 'GET', request); return denied ?? businessProfileRequest(request, 'versions'); }
