import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import path from 'node:path';
import { z } from 'zod';
import { KEY_SLOTS, listKeyStatuses, upsertEnvLocal } from '@/lib/keys';

export const dynamic = 'force-dynamic';

const ENV_LOCAL = path.join(process.cwd(), '.env.local');

export async function GET() {
  const authError = await apiSessionError('/api/admin/keys', 'GET');
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  return NextResponse.json({ keys: listKeyStatuses() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

const SetKeySchema = z.object({
  envVar: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  value: z.string().min(1).max(4096),
});

export async function POST(request: Request) {
  const authError = await apiSessionError('/api/admin/keys', 'POST', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace(request.headers);
  if (operatorAccess instanceof Response) return operatorAccess;

  const parsed = SetKeySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { envVar, value } = parsed.data;
  if (!KEY_SLOTS.some((slot) => slot.envVar === envVar)) {
    return NextResponse.json({ error: `unknown key slot: ${envVar}` }, { status: 400 });
  }
  upsertEnvLocal(ENV_LOCAL, envVar, value);
  process.env[envVar] = value;
  return NextResponse.json({ ok: true, envVar }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
