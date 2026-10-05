import { apiSessionError } from '@/lib/session';
import { financialImportRequest } from '@/lib/financial-import-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { const denied = await apiSessionError('/api/finances/imports', 'GET', request); return denied ?? financialImportRequest(request); }
export async function POST(request: Request) { const denied = await apiSessionError('/api/finances/imports', 'POST', request); return denied ?? financialImportRequest(request); }
