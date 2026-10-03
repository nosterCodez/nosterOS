import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { searchInboxEmails } from '@/lib/connectors/email';
import { EmailInboxItemSchema } from '@/lib/email-thread';

export const dynamic = 'force-dynamic';

const SearchQuerySchema = z.object({
  account: z.string().min(1).max(80),
  q: z.string().trim().min(2).max(200),
});

export async function GET(request: Request) {
  const authError = await apiSessionError('/api/comms/email/search', 'GET', request);
  if (authError) return authError;

  const parsed = SearchQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const result = await searchInboxEmails(parsed.data.account, parsed.data.q, 50);
  if (!result.ok) return NextResponse.json({ items: [], unavailable: true, error: result.error });
  return NextResponse.json({ items: z.array(EmailInboxItemSchema).parse(result.value) });
}
