import { apiSessionError } from '@/lib/session';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiWorkspace } from '@/lib/session';
import { CONTACT_TIERS } from '@/lib/life-map';
import { ContactTagSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = await apiSessionError('/api/contacts/tags', 'GET');
  if (authError) return authError;
  const workspace = await apiWorkspace();
  if (workspace instanceof Response) return workspace;


  return NextResponse.json({ tiers: CONTACT_TIERS, tags: workspace.db.contactTags.all() });
}

export async function POST(request: Request) {
  const authError = await apiSessionError('/api/contacts/tags', 'POST', request);
  if (authError) return authError;
  const workspace = await apiWorkspace(request.headers);
  if (workspace instanceof Response) return workspace;


  const parsed = ContactTagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  workspace.db.contactTags.upsert(parsed.data);
  return NextResponse.json({ ok: true, tag: parsed.data });
}

const RemoveSchema = z.object({ person: z.string().min(1), channel: z.string().min(1) });

export async function DELETE(request: Request) {
  const authError = await apiSessionError('/api/contacts/tags', 'DELETE', request);
  if (authError) return authError;
  const workspace = await apiWorkspace(request.headers);
  if (workspace instanceof Response) return workspace;


  const parsed = RemoveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  workspace.db.contactTags.remove(parsed.data.person, parsed.data.channel);
  return NextResponse.json({ ok: true });
}
