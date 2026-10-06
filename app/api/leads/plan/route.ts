import { apiSessionError } from '@/lib/session';
import { leadPlanRequest } from '@/lib/leads/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { const denied = await apiSessionError('/api/leads/plan', 'GET', request); return denied ?? leadPlanRequest(request); }
export async function POST(request: Request) { const denied = await apiSessionError('/api/leads/plan', 'POST', request); return denied ?? leadPlanRequest(request); }
