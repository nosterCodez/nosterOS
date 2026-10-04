import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { sendSystemMail } from '@/lib/system-mail';

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));
const input = { template: 'magic-link' as const, email: 'test@example.com', url: 'https://os.example.com/api/auth/magic-link/verify?token=test-only' };
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NOSTEROS_BASE_URL', 'https://os.example.com');
  vi.stubEnv('RESEND_API_KEY', 'test-only-key');
  vi.stubEnv('SYSTEM_MAIL_FROM', 'nosterOS <auth@example.com>');
  vi.stubEnv('SMTP_HOST', 'smtp.example.com');
  smtp.createTransport.mockReturnValue(smtp);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

test('Resend delivers fixed templates over HTTPS instead of SMTP', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'test-id' }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  await sendSystemMail(input);
  expect(fetch).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) }));
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body).toMatchObject({ to: [input.email], from: 'nosterOS <auth@example.com>', subject: 'Sign in to nosterOS' });
  expect(body.text).toContain(input.url);
  expect(smtp.createTransport).not.toHaveBeenCalled();
});
test('provider errors do not expose response contents or silently fall back', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-provider-content', { status: 403 })));
  await expect(sendSystemMail(input)).rejects.toThrow('System mail delivery failed');
  expect(smtp.createTransport).not.toHaveBeenCalled();
});
test('network errors are sanitized', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(input.url)));
  await expect(sendSystemMail(input)).rejects.toThrow(/^System mail delivery failed$/);
});
test('slow delivery is aborted after ten seconds', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  })));
  const result = expect(sendSystemMail(input)).rejects.toThrow('System mail delivery failed');
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(signal!.aborted).toBe(true);
});
test('untrusted origins and missing senders fail before network access', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(sendSystemMail({ ...input, url: 'https://other.example.com/' })).rejects.toThrow('NOSTEROS_BASE_URL');
  vi.stubEnv('SYSTEM_MAIL_FROM', '');
  await expect(sendSystemMail(input)).rejects.toThrow('SYSTEM_MAIL_FROM');
  expect(fetch).not.toHaveBeenCalled();
});
test('SMTP compatibility has bounded timeouts and always closes', async () => {
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('SMTP_FROM', 'auth@example.com'); vi.stubEnv('SMTP_USER', 'test'); vi.stubEnv('SMTP_PASS', 'test'); vi.stubEnv('SMTP_PORT', '587');
  smtp.sendMail.mockRejectedValue(new Error('private SMTP failure'));
  await expect(sendSystemMail(input)).rejects.toThrow(/^System mail delivery failed$/);
  expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000 }));
  expect(smtp.close).toHaveBeenCalledOnce();
});
