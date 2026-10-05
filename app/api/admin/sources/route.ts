import { apiSessionError } from '@/lib/session';
import { cloudRequest } from '@/lib/cloud-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { const denied = await apiSessionError('/api/admin/sources', 'GET', request); return denied ?? cloudRequest(request); }
export async function POST(request: Request) { const denied = await apiSessionError('/api/admin/sources', 'POST', request); return denied ?? cloudRequest(request); }
