import { z } from 'zod';
import nodemailer from 'nodemailer';

const message = z.discriminatedUnion('template', [
  z.object({ template: z.literal('magic-link'), email: z.string().email(), url: z.string().url() }).strict(),
  z.object({ template: z.literal('workspace-invitation'), email: z.string().email(), url: z.string().url(), workspace: z.string().min(1).max(200) }).strict(),
]);
export type SystemMessage = z.infer<typeof message>;
export async function sendSystemMail(input: SystemMessage): Promise<void> {
  const data = message.parse(input);
  const base = new URL(process.env.NOSTEROS_BASE_URL || 'http://localhost:4100');
  if (new URL(data.url).origin !== base.origin) throw new Error('System mail link must use NOSTEROS_BASE_URL');
  const invitation = data.template === 'workspace-invitation';
  const content = {
    subject: invitation ? 'Your nosterOS workspace invitation' : 'Sign in to nosterOS',
    text: `${invitation ? `You have been invited to ${data.workspace}.` : 'Use this single-use link to sign in to nosterOS.'}\n\n${data.url}\n\nIf you did not request this, you can ignore this message.`,
  };
  if (process.env.RESEND_API_KEY?.trim()) {
    const from = process.env.SYSTEM_MAIL_FROM?.trim();
    if (!from) throw new Error('SYSTEM_MAIL_FROM must be configured for Resend');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [data.email], ...content }),
      });
      if (!response.ok) throw new Error('Provider rejected system mail');
      const result = await response.json();
      if (!result || typeof result.id !== 'string' || !result.id) throw new Error('Provider did not acknowledge system mail');
    } catch {
      // Provider responses can contain addresses or sign-in tokens. Never surface them.
      throw new Error('System mail delivery failed');
    } finally { clearTimeout(timer); }
    return;
  }
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') throw new Error('Platform Resend or SMTP must be configured for system mail in production');
    console.log(`[system-mail:${data.template}] ${data.url}`);
    return;
  }
  if (!process.env.SMTP_FROM || !process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error('Platform SMTP configuration is incomplete');
  const port = Number(process.env.SMTP_PORT || 587);
  if (![465, 587].includes(port)) throw new Error('Platform SMTP must use TLS on port 465 or 587');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transport.sendMail({ from: process.env.SMTP_FROM, to: data.email, ...content }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('SMTP deadline exceeded')), 10_000);
      }),
    ]);
  } catch { throw new Error('System mail delivery failed'); }
  finally { clearTimeout(timer); transport.close(); }
}
