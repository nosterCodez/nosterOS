import { expect, test, vi } from 'vitest';
import { sendEmailReply } from '@/lib/connectors/email';

// Exercise the real v10 module and MIME generation, never SMTP or the network.
vi.mock('nodemailer', async importOriginal => {
  const actual = await importOriginal<typeof import('nodemailer')>();
  return { ...actual, createTransport: () => actual.createTransport({ streamTransport: true, buffer: true }) };
});

test('sendEmailReply dynamically imports Nodemailer 10 and composes an allowed reply offline', async () => {
  expect(await sendEmailReply({ accountId: 'inbox-1', to: 'admin@founderos.example.com', subject: 'Offline compatibility test', text: 'Test only', inReplyTo: '<test@example.com>', references: ['<parent@example.com>'] }, {
    INBOX_1_HOST: 'imap.example.com', INBOX_1_USER: 'alex@vantage.example.com', INBOX_1_PASS: 'test-only',
  })).toEqual({ ok: true });
});
