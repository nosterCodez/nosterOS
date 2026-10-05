import { afterEach, expect, test, vi } from 'vitest';
import { probeKey, probeEmail } from '@/lib/credential-probes';

const imap = vi.hoisted(() => ({ options: vi.fn(), connect: vi.fn(), close: vi.fn() }));
vi.mock('imapflow', () => ({ ImapFlow: class {
  constructor(options: unknown) { imap.options(options); }
  on() {} connect = imap.connect; close = imap.close;
} }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
const providers = ['openai', 'anthropic', 'stripe', 'printify', 'attio', 'foreplay'];
test.each(providers)('%s uses only a fixed GET and safe statuses', async provider => {
  for (const status of [200, 401, 403, 302, 500]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ active: true, confidential: 'discard-me' }, { status }));
    const result = await probeKey(provider, 'synthetic-secret', { fetcher });
    const expected = status === 200 || (status === 403 && ['openai', 'stripe'].includes(provider)) ? 'verified' : [401, 403].includes(status) ? 'rejected' : 'unreachable';
    expect(result.status).toBe(expected);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-secret|discard-me/);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).not.toMatch(/responses|chat|messages|generate/);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
  }
});
test.each(providers)('%s times out without serializing errors', async provider => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const pending = probeKey(provider, 'secret', { fetcher: vi.fn<typeof fetch>(() => new Promise(() => {})) });
  controller.abort(); expect(await pending).toEqual({ status: 'unreachable' });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(10000);
  expect(await probeKey(provider, 'secret', { fetcher: vi.fn().mockRejectedValue(new Error('secret')) })).toEqual({ status: 'unreachable' });
});
test('restricted permissions are explicit, not a claim of collector access', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 403 }));
  expect(await probeKey('openai', 'fixture', { fetcher })).toEqual({ status: 'verified', note: 'restricted key' });
  expect(await probeKey('stripe', 'fixture', { fetcher })).toEqual({ status: 'verified', note: 'missing Charges read' });
});
test('Attio reads only active, rejects inactive and caps the body at 64 KB', async () => {
  for (const [body, status] of [[{ active: false }, 'rejected'], [{ active: 'true' }, 'unreachable'], [{ active: true, extra: 'x'.repeat(65536) }, 'unreachable']] as const) {
    expect((await probeKey('attio', 'fixture', { fetcher: vi.fn().mockResolvedValue(Response.json(body)) })).status).toBe(status);
  }
});
test.each(['gohighlevel', 'manychat', 'fathom', 'arcads'])('%s makes no unconfirmed free endpoint requests', async provider => {
  const fetcher = vi.fn(); expect(await probeKey(provider, 'secret', { fetcher })).toEqual({ status: 'unverifiable' }); expect(fetcher).not.toHaveBeenCalled();
});
test('email uses TLS verifyOnly without mailbox reads; auth failure is sanitized', async () => {
  const input = { host: 'imap.gmail.com', account: 'fixture@example.com', password: 'secret' };
  imap.connect.mockResolvedValue(undefined);
  expect(await probeEmail(input)).toEqual({ status: 'verified' });
  expect(imap.options).toHaveBeenCalledWith(expect.objectContaining({ secure: true, port: 993, verifyOnly: true, includeMailboxes: false, logger: false, tls: { rejectUnauthorized: true } }));
  imap.connect.mockRejectedValue({ authenticationFailed: true, message: 'secret' });
  expect(await probeEmail(input)).toEqual({ status: 'rejected' });
  imap.connect.mockRejectedValue(new Error('secret')); expect(await probeEmail(input)).toEqual({ status: 'unreachable' });
  imap.options.mockClear(); expect(await probeEmail({ ...input, host: '127.0.0.1' })).toEqual({ status: 'incomplete' }); expect(imap.options).not.toHaveBeenCalled();
});
