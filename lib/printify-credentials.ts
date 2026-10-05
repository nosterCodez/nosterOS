import { createHash } from 'node:crypto';
import { accessFor, oauthGeneration } from '@/lib/cloud-oauth';
import { resolveCred, type VaultContext } from '@/lib/creds';
import { CloudError } from '@/lib/cloud-http';

export const PRINTIFY_TOKEN_REJECTED = 'token rejected or missing shops.read';
export const PRINTIFY_UNREACHABLE = 'Printify unreachable, not saved';
export const PRINTIFY_RECONNECT = 'Printify rejected your personal token. Automatic updates are stopped. Save a new token, then select your shop and enable updates again.';
export class PrintifyValidationError extends Error {}

export async function validatePrintifyToken(value: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!value.trim() || value.length > 4096 || /[\r\n\0]/.test(value)) throw new PrintifyValidationError(PRINTIFY_TOKEN_REJECTED);
  const signal = AbortSignal.timeout(10_000);
  let onAbort: () => void = () => {};
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new PrintifyValidationError(PRINTIFY_UNREACHABLE));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const response = await Promise.race([fetcher('https://api.printify.com/v1/shops.json', {
      method: 'GET', headers: { Authorization: `Bearer ${value.trim()}`, 'User-Agent': 'OmegaOS' },
      redirect: 'error', cache: 'no-store', signal,
    }), aborted]);
    // Only the HTTP status is needed. Never buffer, persist or log the shop body.
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw new PrintifyValidationError(PRINTIFY_TOKEN_REJECTED);
    if (response.status !== 200) throw new PrintifyValidationError(PRINTIFY_UNREACHABLE);
  } catch (error) {
    throw new PrintifyValidationError(error instanceof PrintifyValidationError ? error.message : PRINTIFY_UNREACHABLE);
  } finally { signal.removeEventListener('abort', onAbort); }
}

export function printifyCredential(ctx: VaultContext): { method: 'Printify sign-in' | 'Personal token' | null; generation: string } {
  const oauth = oauthGeneration(ctx, 'printify');
  if (oauth) return { method: 'Printify sign-in', generation: oauth };
  if (!resolveCred(ctx, 'PRINTIFY_API_TOKEN')) return { method: null, generation: '' };
  return { method: 'Personal token', generation: `personal:${createHash('sha256').update(JSON.stringify(ctx.db.connectionRecords.get('PRINTIFY_API_TOKEN'))).digest('hex')}` };
}

export async function printifyAccess(ctx: VaultContext, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  // A failed/expired OAuth grant must not silently fall back to a different identity.
  if (oauthGeneration(ctx, 'printify')) return accessFor(ctx, 'printify', signal, fetcher);
  const token = resolveCred(ctx, 'PRINTIFY_API_TOKEN');
  if (!token) throw new CloudError('permission');
  return token;
}
