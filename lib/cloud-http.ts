export class CloudError extends Error {
  constructor(public code: 'permission' | 'authentication' | 'api_disabled' | 'rate_limit' | 'provider' | 'timeout' | 'invalid_data' | 'setup' | 'changed' | 'too_large' = 'provider') { super(code); }
}
const HOSTS = new Set(['oauth2.googleapis.com', 'www.googleapis.com', 'analyticsdata.googleapis.com', 'analyticsadmin.googleapis.com', 'mybusinessbusinessinformation.googleapis.com', 'businessprofileperformance.googleapis.com', 'api.stripe.com', 'graph.facebook.com', 'open.tiktokapis.com', 'api.etsy.com', 'api.linkedin.com', 'www.linkedin.com']);
async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new CloudError('invalid_data');
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw new CloudError('too_large'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function googleApiDisabled(response: Response): Promise<boolean> {
  // Only inspect typed reasons; provider messages/metadata must never reach the UI or logs.
  try {
    const body = await boundedJson(response, 65_536);
    if (!record(body) || !record(body.error) || !Array.isArray(body.error.details)) return false;
    return body.error.details.some(detail => record(detail) && detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && detail.domain === 'googleapis.com' && detail.reason === 'SERVICE_DISABLED');
  } catch { return false; }
}
async function metaError(response: Response): Promise<CloudError['code'] | undefined> {
  try {
    const body = await boundedJson(response, 65_536);
    if (!record(body) || !record(body.error)) return;
    const code = body.error.code;
    if (code === 190) return 'authentication';
    if (code === 10 || code === 200) return 'permission';
    if (code === 4 || code === 17 || code === 32 || code === 613) return 'rate_limit';
  } catch { /* Use the safe HTTP fallback for malformed provider errors. */ }
}
export async function cloudJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname) || target.port || target.username || target.password) throw new CloudError('setup');
  try {
    const timeout = AbortSignal.timeout(8000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetcher(target.toString(), { ...init, signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) {
      const metaCode = target.hostname === 'graph.facebook.com' ? await metaError(response) : undefined;
      if (metaCode) throw new CloudError(metaCode);
      if (response.status === 403 && target.hostname.endsWith('.googleapis.com') && await googleApiDisabled(response)) throw new CloudError('api_disabled');
      if (signal.aborted) throw new CloudError('timeout');
      throw new CloudError(response.status === 429 ? 'rate_limit' : response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : 'provider');
    }
    return await boundedJson(response, 2_000_000);
  } catch (e) { if (e instanceof CloudError) throw e; throw new CloudError(init.signal?.aborted || (e instanceof Error && /Abort|Timeout/.test(e.name)) ? 'timeout' : 'provider'); }
}
export const CLOUD_ERROR_TEXT: Record<CloudError['code'], string> = {
  permission: 'The provider denied access. Check that this account has permission to the selected resource and the requested data.',
  authentication: 'The provider did not accept the saved sign-in. Reconnect your account, then try again.',
  api_disabled: 'A required Google API is disabled in the OmegaOS Google project. An administrator must enable it, then retry. Reconnecting will not fix this.',
  rate_limit: 'Provider rate limit reached. The next scheduled sync will retry.',
  provider: 'Provider unavailable. Last successful data is retained.',
  timeout: 'Sync exceeded its time budget. Last successful data is retained.',
  invalid_data: 'Provider response could not be validated. No numbers were substituted.',
  setup: 'Complete the required account and platform configuration.',
  changed: 'Connection changed during sync. Run again with the current connection.',
  too_large: 'Response exceeds the safe collection limit. No partial totals were saved.',
};
