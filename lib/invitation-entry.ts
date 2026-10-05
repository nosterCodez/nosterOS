import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
const Payload = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), exp: z.number().int().positive() }).strict();
function mac(value: string, secret: string) {
  if (secret.length < 32) throw new Error('Invitation signing is not configured');
  return createHmac('sha256', secret).update('OmegaOS invitation entry v1\0').update(value).digest('base64url');
}
export function invitationEntryURL(baseURL: string, secret: string, id: string, expiresAt: Date) {
  const payload = Payload.parse({ id, exp: expiresAt.getTime() });
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const url = new URL('/join', baseURL); url.searchParams.set('invite', `${encoded}.${mac(encoded, secret)}`);
  return url.toString();
}
export function verifyInvitationEntry(token: string, secret: string, now = Date.now()) {
  try {
    if (token.length > 1024) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const actual = Buffer.from(signature), expected = Buffer.from(mac(payload, secret));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed = Payload.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    return parsed.exp > now ? parsed : null;
  } catch { return null; }
}
