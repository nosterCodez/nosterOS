import { ImapFlow } from 'imapflow';
import { IMAP_HOSTS, type EmailInput, type VerificationResult } from '@/lib/verification-types';

type Options = { fetcher?: typeof fetch; signal?: AbortSignal };
const ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/models', anthropic: 'https://api.anthropic.com/v1/models',
  stripe: 'https://api.stripe.com/v1/charges?limit=1', printify: 'https://api.printify.com/v1/shops.json',
  attio: 'https://api.attio.com/v2/self', foreplay: 'https://public.api.foreplay.co/api/usage',
};
async function bounded(work: (signal: AbortSignal) => Promise<VerificationResult>, parent?: AbortSignal): Promise<VerificationResult> {
  const timeout = AbortSignal.timeout(10000), signal = parent ? AbortSignal.any([timeout, parent]) : timeout;
  let abort: () => void = () => {};
  try {
    if (signal.aborted) return { status: 'unreachable' };
    const stopped = new Promise<VerificationResult>(resolve => {
      abort = () => resolve({ status: 'unreachable' }); signal.addEventListener('abort', abort, { once: true });
    });
    return await Promise.race([work(signal), stopped]);
  } catch { return { status: 'unreachable' }; }
  finally { signal.removeEventListener('abort', abort); }
}
async function attioActive(response: Response, signal: AbortSignal): Promise<VerificationResult> {
  const reader = response.body?.getReader();
  if (!reader) return { status: 'unreachable' };
  const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 65536) return { status: 'unreachable' }; chunks.push(part.value);
    }
    const active: unknown = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { active?: unknown } | null)?.active;
    return { status: active === true ? 'verified' : active === false ? 'rejected' : 'unreachable' };
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
export async function probeKey(provider: string, value: string, options: Options = {}): Promise<VerificationResult> {
  const url = Object.hasOwn(ENDPOINTS, provider) ? ENDPOINTS[provider] : undefined;
  if (!url) return { status: 'unverifiable' };
  if (!value.trim() || value.length > 4096 || /[\r\n\0]/.test(value)) return { status: 'rejected' };
  return bounded(async signal => {
    const headers: Record<string, string> = provider === 'anthropic'
      ? { 'x-api-key': value.trim(), 'anthropic-version': '2023-06-01' }
      : { Authorization: provider === 'foreplay' ? value.trim() : `Bearer ${value.trim()}` };
    if (provider === 'printify') headers['User-Agent'] = 'OmegaOS';
    const response = await (options.fetcher ?? fetch)(url, { method: 'GET', headers, redirect: 'error', cache: 'no-store', signal });
    if (response.redirected || signal.aborted) { void response.body?.cancel().catch(() => {}); return { status: 'unreachable' }; }
    if (provider === 'attio' && response.status === 200) return attioActive(response, signal);
    // Never buffer provider bodies, except Attio's explicitly approved bounded boolean.
    void response.body?.cancel().catch(() => {});
    if (response.status === 403 && provider === 'openai') return { status: 'verified', note: 'restricted key' };
    if (response.status === 403 && provider === 'stripe') return { status: 'verified', note: 'missing Charges read' };
    if ([401, 403].includes(response.status)) return { status: 'rejected' };
    if (response.status !== 200) return { status: 'unreachable' };
    return provider === 'stripe' ? { status: 'verified', note: 'read-only' } : { status: 'verified' };
  }, options.signal);
}
export async function probeEmail(input: EmailInput, options: { signal?: AbortSignal } = {}): Promise<VerificationResult> {
  if (!IMAP_HOSTS.includes(input.host) || !input.account.trim() || !input.password.trim()) return { status: 'incomplete' };
  return bounded(async signal => {
    const client = new ImapFlow({ host: input.host, port: 993, secure: true,
      auth: { user: input.account, pass: input.password }, logger: false, verifyOnly: true, includeMailboxes: false,
      disableAutoIdle: true, disableAutoEnable: true, connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 8000,
      tls: { rejectUnauthorized: true },
    });
    client.on('error', () => {});
    const close = () => client.close(); signal.addEventListener('abort', close, { once: true });
    try {
      // verifyOnly authenticates and logs out; it never selects or fetches a mailbox.
      await client.connect(); signal.throwIfAborted(); return { status: 'verified' };
    } catch (error) { return { status: error && typeof error === 'object' && 'authenticationFailed' in error && error.authenticationFailed === true ? 'rejected' : 'unreachable' }; }
    finally { signal.removeEventListener('abort', close); close(); }
  }, options.signal);
}
