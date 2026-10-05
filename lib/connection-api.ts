import { z } from 'zod';
import { apiSessionError, requireWorkspace, SessionError, withWorkspaceLease } from '@/lib/session';
import { connectionMetadata, revokeCredential, saveCredential, vaultReady, VaultError } from '@/lib/creds';
import { PrintifyValidationError, validatePrintifyToken } from '@/lib/printify-credentials';

const NameSchema = z.object({ name: z.string().max(64) }).strict();
const SaveSchema = NameSchema.extend({ value: z.string().min(1).max(4096) }).strict();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function limitedBody(request: Request, maxBytes = 8192) {
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
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
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
        const parsed = SaveSchema.safeParse(body);
        if (!parsed.success) return json({ error: 'Invalid connection request' }, 400);
        if (parsed.data.name === 'PRINTIFY_API_TOKEN') {
          if (!vaultReady(scoped)) throw new VaultError();
          const before = JSON.stringify([db.connectionRecords.get(parsed.data.name), db.cloudSources.get('printify')?.revision]);
          await validatePrintifyToken(parsed.data.value);
          const fresh = await requireWorkspace('admin', new Headers(request.headers), 'api');
          if (fresh.workspace.id !== context.workspace.id || fresh.user.id !== context.user.id || before !== JSON.stringify([db.connectionRecords.get(parsed.data.name), db.cloudSources.get('printify')?.revision])) return json({ error: 'Connection changed. Reload Connections before saving.' }, 409);
        }
        saveCredential(scoped, parsed.data.name, parsed.data.value);
      } else if (request.method === 'DELETE') {
        const parsed = NameSchema.safeParse(body);
        if (!parsed.success) return json({ error: 'Invalid connection request' }, 400);
        revokeCredential(scoped, parsed.data.name);
      }
      return json({ ready: vaultReady(scoped), connections: connectionMetadata(scoped) });
    });
  } catch (error) {
    if (error instanceof PrintifyValidationError) return json({ error: error.message }, 400);
    if (error instanceof SessionError) return json({ error: error.message }, error.status);
    if (error instanceof VaultError) return json({ error: 'Connection vault unavailable. Contact your administrator.' }, 503);
    // Never serialize parser errors, credential values, provider errors or database contents.
    return json({ error: 'Invalid connection request' }, 400);
  }
}
