import { apiSessionError } from '@/lib/session';
import { businessProfileRequest } from '@/lib/business-profile/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { const denied = await apiSessionError('/api/business-profile/restore', 'POST', request); return denied ?? businessProfileRequest(request, 'restore'); }
