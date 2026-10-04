import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchEmailThread } from '@/lib/connectors/email';
import { EmailThreadSchema } from '@/lib/email-thread';

export const dynamic = 'force-dynamic';

const ThreadQuerySchema = z
  .object({
    account: z.string().min(1).max(80),
    threadId: z.string().min(1).max(500).optional(),
    messageId: z.string().min(1).max(998).optional(),
    uid: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => value.threadId || value.messageId || value.uid, 'a threadId, messageId, or uid is required');

export async function GET(request: Request) {
  const authError = await apiSessionError('/api/comms/email/thread', 'GET', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  const url = new URL(request.url);
  const parsed = ThreadQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { account, ...identifiers } = parsed.data;
  const result = await fetchEmailThread({ accountId: account, ...identifiers });
  if (!result.ok) return NextResponse.json({ unavailable: true, error: result.error });
  return NextResponse.json(EmailThreadSchema.parse(result.value));
}
