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
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') throw new Error('Platform SMTP must be configured for system mail in production');
    console.log(`[system-mail:${data.template}] ${data.url}`);
    return;
  }
  if (!process.env.SMTP_FROM || !process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error('Platform SMTP configuration is incomplete');
  const port = Number(process.env.SMTP_PORT || 587);
  if (![465, 587].includes(port)) throw new Error('Platform SMTP must use TLS on port 465 or 587');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const invitation = data.template === 'workspace-invitation';
  await transport.sendMail({
    from: process.env.SMTP_FROM, to: data.email,
    subject: invitation ? 'Your nosterOS workspace invitation' : 'Sign in to nosterOS',
    text: `${invitation ? `You have been invited to ${data.workspace}.` : 'Use this single-use link to sign in to nosterOS.'}\n\n${data.url}\n\nIf you did not request this, you can ignore this message.`,
  });
}
