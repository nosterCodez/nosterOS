import { etsyBodyDiagnostic, etsyErrorFields, type ProviderDiagnostic } from '@/lib/cloud-diagnostics';

export class CloudError extends Error {
  constructor(public code: 'permission' | 'authentication' | 'api_disabled' | 'platform_approval' | 'rate_limit' | 'provider' | 'timeout' | 'invalid_data' | 'setup' | 'changed' | 'too_large' = 'provider', public diagnostic?: ProviderDiagnostic) { super(code); }
}
const HOSTS = new Set(['oauth2.googleapis.com', 'www.googleapis.com', 'analyticsdata.googleapis.com', 'analyticsadmin.googleapis.com', 'mybusinessbusinessinformation.googleapis.com', 'businessprofileperformance.googleapis.com', 'googleads.googleapis.com', 'api.stripe.com', 'graph.facebook.com', 'open.tiktokapis.com', 'api.etsy.com', 'api.linkedin.com', 'www.linkedin.com']);
async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new CloudError('invalid_data');
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw new CloudError('too_large'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export async function etsyKeyPing(appHeaders: Record<string, string>, fetcher: typeof fetch = fetch) {
  const key = appHeaders['x-api-key']; if (!key) throw new CloudError('setup');
  const signal = AbortSignal.timeout(8000);
  try {
    // Fixed key-only probe: never forward caller headers, cookies, or user tokens.
    const response = await fetcher('https://api.etsy.com/v3/application/openapi-ping', { method: 'GET', headers: { 'x-api-key': key }, signal, redirect: 'error', cache: 'no-store' });
    let body: unknown;
    try { body = await boundedJson(response, 65_536); } catch { /* Preserve status, not unreadable/raw bodies. */ }
    if (signal.aborted) throw new CloudError('timeout');
    return { httpStatus: response.status, errorFields: etsyErrorFields(body) ?? null,
      ...(response.status >= 400 && response.status <= 599 ? { diagnostic: etsyBodyDiagnostic(response.status, body, [key, ...key.split(':')]) } : {}) };
  } catch (e) { if (e instanceof CloudError) throw e; throw new CloudError(signal.aborted ? 'timeout' : 'provider'); }
}
async function googleError(response: Response): Promise<CloudError['code'] | undefined> {
  // Only inspect typed reasons; provider messages/metadata must never reach the UI or logs.
  try {
    const body = await boundedJson(response, 65_536);
    if (!record(body) || !record(body.error) || !Array.isArray(body.error.details)) return;
    for (const detail of body.error.details) {
      if (!record(detail)) continue;
      if (detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && detail.domain === 'googleapis.com' && detail.reason === 'SERVICE_DISABLED') return 'api_disabled';
      if (typeof detail['@type'] === 'string' && /^type\.googleapis\.com\/google\.ads\.googleads\.v\d+\.errors\.GoogleAdsFailure$/.test(detail['@type']) && Array.isArray(detail.errors) && detail.errors.some(e => record(e) && record(e.errorCode) && e.errorCode.authorizationError === 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION')) return 'platform_approval';
    }
  } catch { /* Use safe HTTP fallback. */ }
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
  const shopify = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(target.hostname) && ['/admin/oauth/access_token', '/admin/api/2026-10/graphql.json'].includes(target.pathname) && !target.search && !target.hash;
  if (target.protocol !== 'https:' || !(HOSTS.has(target.hostname) || target.hostname === 'api.printify.com' || shopify) || target.port || target.username || target.password) throw new CloudError('setup');
  try {
    const timeout = AbortSignal.timeout(8000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetcher(target.toString(), { ...init, signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) {
      if (target.hostname === 'api.etsy.com' && response.status >= 400 && response.status <= 599) {
        let errorBody: unknown;
        try { errorBody = await boundedJson(response, 65_536); } catch { /* Unknown errors remain redacted. */ }
        if (signal.aborted) throw new CloudError('timeout');
        const headers = new Headers(init.headers), token = headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '', key = headers.get('x-api-key') ?? '';
        const body = typeof init.body === 'string' ? new URLSearchParams(init.body) : undefined;
        const secrets = [token, token.replace(/^\d+\./, ''), key, ...key.split(':'), body?.get('refresh_token') ?? '', body?.get('code') ?? '', body?.get('code_verifier') ?? ''];
        throw new CloudError(response.status === 429 ? 'rate_limit' : response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : 'provider', etsyBodyDiagnostic(response.status, errorBody, secrets));
      }
      const metaCode = target.hostname === 'graph.facebook.com' ? await metaError(response) : undefined;
      if (metaCode) throw new CloudError(metaCode);
      const googleCode = response.status === 403 && target.hostname.endsWith('.googleapis.com') ? await googleError(response) : undefined;
      if (googleCode) throw new CloudError(googleCode);
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
  platform_approval: 'The OmegaOS Google project needs Google Ads production-access approval. Reconnecting your account will not resolve this.',
  rate_limit: 'Provider rate limit reached. The next scheduled sync will retry.',
  provider: 'Provider unavailable. Last successful data is retained.',
  timeout: 'Sync exceeded its time budget. Last successful data is retained.',
  invalid_data: 'Provider response could not be validated. No numbers were substituted.',
  setup: 'Complete the required account and platform configuration.',
  changed: 'Connection changed during sync. Run again with the current connection.',
  too_large: 'Response exceeds the safe collection limit. No partial totals were saved.',
};
