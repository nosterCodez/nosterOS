export class CloudError extends Error {
  constructor(public code: 'permission' | 'rate_limit' | 'provider' | 'timeout' | 'invalid_data' | 'setup' | 'changed' | 'too_large' = 'provider') { super(code); }
}
const HOSTS = new Set(['oauth2.googleapis.com', 'www.googleapis.com', 'analyticsdata.googleapis.com', 'businessprofileperformance.googleapis.com', 'api.stripe.com', 'graph.facebook.com', 'open.tiktokapis.com', 'api.etsy.com', 'api.linkedin.com', 'www.linkedin.com']);
export async function cloudJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname) || target.port || target.username || target.password) throw new CloudError('setup');
  try {
    const timeout = AbortSignal.timeout(8000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetcher(target.toString(), { ...init, signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new CloudError(response.status === 429 ? 'rate_limit' : [401, 403].includes(response.status) ? 'permission' : 'provider');
    const reader = response.body?.getReader(); if (!reader) throw new CloudError('invalid_data');
    let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2_000_000) { await reader.cancel(); throw new CloudError('too_large'); } chunks.push(part.value); } }
    finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) { if (e instanceof CloudError) throw e; throw new CloudError(init.signal?.aborted || (e instanceof Error && /Abort|Timeout/.test(e.name)) ? 'timeout' : 'provider'); }
}
export const CLOUD_ERROR_TEXT: Record<CloudError['code'], string> = {
  permission: 'Access denied or expired. Reconnect and check resource permissions.',
  rate_limit: 'Provider rate limit reached. The next scheduled sync will retry.',
  provider: 'Provider unavailable. Last successful data is retained.',
  timeout: 'Sync exceeded its time budget. Last successful data is retained.',
  invalid_data: 'Provider response could not be validated. No numbers were substituted.',
  setup: 'Complete the required account and platform configuration.',
  changed: 'Connection changed during sync. Run again with the current connection.',
  too_large: 'Response exceeds the safe collection limit. No partial totals were saved.',
};
