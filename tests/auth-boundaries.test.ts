import { describe, expect, test, vi, afterEach } from 'vitest';
import { internalAllowed, publicAuthPath } from '@/lib/auth-boundary';
import { sendSystemMail } from '@/lib/system-mail';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('M1 authentication boundaries', () => {
  test('internal secret is accepted on only three exact paths', () => {
    for (const path of ['/api/cron/tick', '/api/agents/failover', '/api/analytics/refresh']) {
      expect(internalAllowed(path, 'secret', 'secret')).toBe(true);
      expect(internalAllowed(path, 'wrong', 'secret')).toBe(false);
      expect(internalAllowed(path, '', '')).toBe(false);
    }
    expect(internalAllowed('/api/agents', 'secret', 'secret')).toBe(false);
    expect(internalAllowed('/api/cron/tick/extra', 'secret', 'secret')).toBe(false);
  });
  test('public auth paths do not include onboarding or application APIs', () => {
    expect(publicAuthPath('/sign-in')).toBe(true);
    expect(publicAuthPath('/api/auth/sign-in/magic-link')).toBe(true);
    expect(publicAuthPath('/accept-invitation')).toBe(true);
    expect(publicAuthPath('/onboarding')).toBe(false);
    expect(publicAuthPath('/api/agents')).toBe(false);
  });
  test('production without SMTP fails without logging a login link', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('RESEND_API_KEY', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(sendSystemMail({ template: 'magic-link', email: 'test@example.com', url: 'http://localhost:4100/api/auth/magic-link/verify?token=test' })).rejects.toThrow('SMTP');
    expect(log).not.toHaveBeenCalled();
  });
  test('free-form content is rejected', async () => {
    await expect(sendSystemMail({ template: 'magic-link', email: 'test@example.com', url: 'http://localhost:4100/', html: '<b>arbitrary</b>' } as never)).rejects.toThrow();
  });
});
