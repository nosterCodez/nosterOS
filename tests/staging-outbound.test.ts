import { afterEach, expect, test, vi } from 'vitest';
import { assertOutboundAllowed } from '@/lib/outbound-guard';
import { checkOutboundMail } from '@/lib/mail-guard.mjs';
import { sendEmailReply } from '@/lib/connectors/email';
import { sendSlackMessage } from '@/lib/connectors/slack';
import { sendManyChatText } from '@/lib/connectors/manychat';
import { addEventGuests } from '@/lib/connectors/gcal-write';
import { zernioPublish } from '@/lib/connectors/zernio';
import { sendSystemMail } from '@/lib/system-mail';

const network = vi.hoisted(() => ({ slack: vi.fn(), smtp: vi.fn() }));
vi.mock('@slack/web-api', () => ({ WebClient: class { constructor() { network.slack(); } } }));
vi.mock('nodemailer', () => ({ default: { createTransport: network.smtp }, createTransport: network.smtp }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('outbound flag overrides every mail override and cannot be bypassed with injected env', () => {
  vi.stubEnv('OMEGA_OUTBOUND_DISABLED', '1');
  for (const kind of ['email', 'slack', 'manychat', 'calendar', 'social', 'invoice']) {
    expect(() => assertOutboundAllowed(kind, {})).toThrow('Outbound messages are disabled');
    expect(() => assertOutboundAllowed(kind, { OMEGA_OUTBOUND_DISABLED: '0' })).toThrow('disabled');
  }
  expect(checkOutboundMail({ from: 'alex@vantage.example.com', to: 'founder@founderos.example.com' }, { MAIL_ALLOW_EXTERNAL: '1' }))
    .toMatchObject({ ok: false, error: expect.stringContaining('disabled') });
});

test('off flag leaves existing mail approvals enforced', () => {
  vi.stubEnv('OMEGA_OUTBOUND_DISABLED', '0');
  expect(() => assertOutboundAllowed('email')).not.toThrow();
  expect(() => assertOutboundAllowed('email', { OMEGA_OUTBOUND_DISABLED: '1' })).toThrow('disabled');
  expect(checkOutboundMail({ from: 'sender@example.com', to: 'customer@example.com' })).toMatchObject({ ok: false });
});

test('each real message connector refuses before any provider call', async () => {
  vi.stubEnv('OMEGA_OUTBOUND_DISABLED', '1');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(await sendEmailReply({ to: 'customer@example.com', subject: 'test', text: 'test' }, {
    INBOX_1_HOST: 'imap.example.com', INBOX_1_USER: 'sender@example.com', INBOX_1_PASS: 'fixture', MAIL_ALLOW_EXTERNAL: '1',
  })).toMatchObject({ ok: false, error: expect.stringContaining('disabled') });
  expect(await sendSlackMessage('general', 'test', { SLACK_BOT_TOKEN: 'fixture' })).toMatchObject({ ok: false, detail: expect.stringContaining('disabled') });
  expect(await sendManyChatText('123', 'test', { MANYCHAT_API_KEY: 'fixture' }, fetcher)).toMatchObject({ ok: false, detail: expect.stringContaining('disabled') });
  expect(await zernioPublish({ caption: 'test', mediaUrls: [], platforms: ['instagram'] })).toMatchObject({ ok: false, error: expect.stringContaining('disabled') });
  for (const sendUpdates of ['all', 'externalOnly'] as const) {
    expect(await addEventGuests({ creds: { clientId: 'fixture', clientSecret: 'fixture', refreshToken: 'fixture' }, calendarId: 'fixture', eventId: 'fixture', emails: ['a@example.com'], sendUpdates, fetchImpl: fetcher }))
      .toMatchObject({ ok: false, error: expect.stringContaining('disabled') });
  }
  expect(fetcher).not.toHaveBeenCalled(); expect(network.slack).not.toHaveBeenCalled(); expect(network.smtp).not.toHaveBeenCalled();
});

test.each(['magic-link', 'workspace-invitation'] as const)('validated system mail %s stays available with outbound disabled', async template => {
  vi.stubEnv('OMEGA_OUTBOUND_DISABLED', '1');
  vi.stubEnv('NOSTEROS_BASE_URL', 'https://staging.example.com');
  vi.stubEnv('RESEND_API_KEY', 'test-only'); vi.stubEnv('SYSTEM_MAIL_FROM', 'auth@example.com');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'fixture' })); vi.stubGlobal('fetch', fetcher);
  await sendSystemMail({ template, email: 'member@example.com', url: 'https://staging.example.com/sign-in', ...(template === 'workspace-invitation' ? { workspace: 'Fixture' } : {}) } as Parameters<typeof sendSystemMail>[0]);
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(sendSystemMail({ template: 'newsletter', email: 'member@example.com', url: 'https://staging.example.com/' } as never)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});
