import { apiOperatorWorkspace } from '@/lib/session';
import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { downloadEmailAttachment } from '@/lib/connectors/email';

export const dynamic = 'force-dynamic';

const AttachmentQuerySchema = z.object({
  account: z.string().min(1).max(80),
  threadId: z.string().min(1).max(500),
  uid: z.coerce.number().int().positive(),
  part: z.string().regex(/^\d+(?:\.\d+)*$/),
});

export async function GET(request: Request) {
  const authError = await apiSessionError('/api/comms/email/attachment', 'GET', request);
  if (authError) return authError;
  const operatorAccess = await apiOperatorWorkspace();
  if (operatorAccess instanceof Response) return operatorAccess;

  const parsed = AttachmentQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { account, ...attachment } = parsed.data;
  const result = await downloadEmailAttachment({ accountId: account, ...attachment });
  if (!result.ok) return NextResponse.json({ unavailable: true, error: result.error });
  const fallback = result.value.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(new Uint8Array(result.value.data), {
    headers: {
      'Content-Type': result.value.contentType,
      'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(result.value.filename)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
