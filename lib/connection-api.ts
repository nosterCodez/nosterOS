import { z } from 'zod';
import { apiSessionError, requireWorkspace, SessionError, withWorkspaceLease } from '@/lib/session';
import { connectionMetadata, revokeCredential, vaultReady, VaultError } from '@/lib/creds';
import { emailDefaults, verifyCredential, VerificationError } from '@/lib/credential-verification';
import { EMAIL_FIELDS } from '@/lib/verification-types';

const NameSchema = z.object({ name: z.string().max(64) }).strict();
const SaveSchema = NameSchema.extend({ value: z.string().min(1).max(4096) }).strict();
const VerifySchema = NameSchema.extend({ action: z.literal('verify') }).strict();
const EmailSchema = z.object({ name: z.literal('email'), email: z.object({ host: z.string().max(255), account: z.string().max(512), password: z.string().max(4096) }).strict() }).strict();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function limitedBody(request: Request, maxBytes = 8192, strictUtf8 = false) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Invalid request');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid request');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Invalid request'); }
      chunks.push(result.value);
    }
    const bytes = Buffer.concat(chunks);
    return JSON.parse(strictUtf8 ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : bytes.toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}
export async function connectionRequest(request: Request) {
  const denied = await apiSessionError('/api/admin/connections', request.method, request);
  if (denied) return denied;
  try {
    const context = await requireWorkspace('admin', request.headers, 'api');
    if (request.method !== 'GET' && request.headers.get('x-omegaos-workspace') !== context.workspace.id) return json({ error: 'Workspace changed. Reload Connections before saving.' }, 409);
    const body = request.method === 'GET' ? null : await limitedBody(request);
    return await withWorkspaceLease(context, async db => {
      const scoped = { ...context, db };
      if (request.method === 'POST') {
        const parsed = z.union([SaveSchema, VerifySchema, EmailSchema]).safeParse(body);
        if (!parsed.success) return json({ error: 'Invalid connection request' }, 400);
        if (parsed.data.name === 'email' && 'value' in parsed.data) return json({ error: 'Invalid connection request' }, 400);
        const reauthorize = async () => {
          const fresh = await requireWorkspace('admin', new Headers(request.headers), 'api');
          if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id) throw new VerificationError('Connection changed. Reload Connections before saving.', 409);
        };
        await verifyCredential(scoped, parsed.data.name, { ...('value' in parsed.data ? { value: parsed.data.value } : 'email' in parsed.data ? { email: parsed.data.email } : {}), reauthorize });
      } else if (request.method === 'DELETE') {
        const parsed = NameSchema.safeParse(body);
        if (!parsed.success) return json({ error: 'Invalid connection request' }, 400);
        if ((EMAIL_FIELDS as readonly string[]).includes(parsed.data.name)) throw new VerificationError('Disconnect email as one connection.');
        db.connectionRecords.atomic(() => (parsed.data.name === 'email' ? EMAIL_FIELDS : [parsed.data.name]).forEach(name => revokeCredential(scoped, name)));
      }
      return json({ ready: vaultReady(scoped), connections: connectionMetadata(scoped), email: emailDefaults(scoped) });
    });
  } catch (error) {
    if (error instanceof VerificationError) return json({ error: error.message }, error.status);
    if (error instanceof SessionError) return json({ error: error.message }, error.status);
    if (error instanceof VaultError) return json({ error: 'Connection vault unavailable. Contact your administrator.' }, 503);
    // Never serialize parser errors, credential values, provider errors or database contents.
    return json({ error: 'Invalid connection request' }, 400);
  }
}
