import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { oauthId, type OAuthId } from '@/lib/cloud-catalog';
import { readVaultValue, saveVaultValue, revokeVaultValue, type VaultContext } from '@/lib/creds';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import { challengeFor } from '@/lib/oauth/pkce';

type AuthContext = VaultContext & { user: { id: string }; sessionBinding?: string };
type Provider = { id: OAuthId; authorize: string; token: string; scopes: string[]; env: string; pkce: boolean; separator?: string; clientName?: string; refresh: boolean };
export function cloudProvider(input: string): Provider {
  const id = oauthId(input);
  const version = process.env.OMEGA_META_API_VERSION;
  const google = { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', env: 'OMEGA_GOOGLE', pkce: true, refresh: true };
  switch (id) {
    case 'google': return { id, ...google, scopes: ['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'] };
    case 'google-business': return { id, ...google, scopes: ['https://www.googleapis.com/auth/business.manage'] };
    case 'google-ads': return { id, ...google, scopes: ['https://www.googleapis.com/auth/adwords'] };
    case 'meta': return { id, authorize: `https://www.facebook.com/${version ?? ''}/dialog/oauth`, token: `https://graph.facebook.com/${version ?? ''}/oauth/access_token`, env: 'OMEGA_META', scopes: ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'ads_read'], pkce: false, separator: ',', refresh: false };
    case 'tiktok': return { id, authorize: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/', env: 'OMEGA_TIKTOK', scopes: ['user.info.basic', 'user.info.stats'], pkce: false, separator: ',', clientName: 'client_key', refresh: true };
    case 'linkedin': throw new CloudError('setup'); // Developer app and reporting product access are not approved.
    case 'etsy': return { id, authorize: 'https://www.etsy.com/oauth/connect', token: 'https://api.etsy.com/v3/public/oauth/token', env: 'OMEGA_ETSY', scopes: ['shops_r'], pkce: true, refresh: true };
  }
}
export function providerReady(id: string) {
  if (id === 'linkedin' || (id === 'google-business' && process.env.OMEGA_GOOGLE_BUSINESS_ENABLED !== '1')) return false;
  if (id === 'google-ads' && (process.env.OMEGA_GOOGLE_ADS_ENABLED !== '1' || process.env.OMEGA_GOOGLE_ADS_API_VERSION !== 'v25')) return false;
  const p = cloudProvider(id);
  return Boolean(process.env[`${p.env}_CLIENT_ID`] && process.env[`${p.env}_CLIENT_SECRET`] &&
    (id !== 'meta' || /^v\d+\.0$/.test(process.env.OMEGA_META_API_VERSION ?? '')) &&
    (id !== 'linkedin' || /^\d{6}$/.test(process.env.OMEGA_LINKEDIN_API_VERSION ?? '')));
}
export function callbackUrl(id: string) {
  const base = new URL(process.env.NOSTEROS_BASE_URL!);
  if ((base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) || base.username || base.password) throw new CloudError('setup');
  return new URL(`/api/connections/oauth/${oauthId(id)}/callback`, base.origin).toString();
}
const StateSchema = z.object({ provider: z.string(), workspace: z.string(), user: z.string(), session: z.string(), nonce: z.string(), issued: z.number() }).strict();
const PendingSchema = z.object({ state: z.string(), verifier: z.string(), tokenVersion: z.string() }).strict();
const TokensSchema = z.object({ access: z.string().min(1).max(16000), refresh: z.string().max(8000).optional(), expires: z.number(), generation: z.string() }).strict();
const TokenResponse = z.object({ access_token: z.string().min(1).max(16000), refresh_token: z.string().max(8000).optional(), expires_in: z.coerce.number().positive().max(366 * 86400), scope: z.string().optional() });
const slot = (id: string, kind = 'tokens') => `oauth:${oauthId(id)}:${kind}`;
function sign(payload: string) {
  const key = process.env.NOSTEROS_MASTER_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new CloudError('setup');
  return createHmac('sha256', Buffer.from(key, 'hex')).update('OmegaOS OAuth state v1\0').update(payload).digest('base64url');
}
function version(ctx: VaultContext, name: string) { const r = ctx.db.connectionRecords.get(name); return r ? createHash('sha256').update(JSON.stringify(r)).digest('hex') : ''; }
export function beginAuthorization(ctx: AuthContext, id: string, now = Date.now()) {
  if (!providerReady(id)) throw new CloudError('setup');
  const p = cloudProvider(id), verifier = randomBytes(48).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ provider: id, workspace: ctx.workspace.id, user: ctx.user.id, session: ctx.sessionBinding ?? '', nonce: randomBytes(24).toString('base64url'), issued: now })).toString('base64url');
  const state = `${payload}.${sign(payload)}`;
  saveVaultValue(ctx, slot(id, 'pending'), JSON.stringify({ state, verifier, tokenVersion: version(ctx, slot(id)) }));
  const url = new URL(p.authorize);
  url.search = new URLSearchParams({ [p.clientName ?? 'client_id']: process.env[`${p.env}_CLIENT_ID`]!, response_type: 'code', redirect_uri: callbackUrl(id), scope: p.scopes.join(p.separator ?? ' '), state }).toString();
  if (p.pkce) { url.searchParams.set('code_challenge', challengeFor(verifier)); url.searchParams.set('code_challenge_method', 'S256'); }
  if (id.startsWith('google')) { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); }
  return { url: url.toString() };
}
export function consumeAuthorization(ctx: AuthContext, id: string, state: string, now = Date.now()) {
  if (state.length > 2048) throw new CloudError('permission');
  const [payload, mac, extra] = state.split('.');
  const expected = Buffer.from(sign(payload ?? '')), actual = Buffer.from(mac ?? '');
  if (extra || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new CloudError('permission');
  const parsed = StateSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
  if (parsed.provider !== id || parsed.workspace !== ctx.workspace.id || parsed.user !== ctx.user.id || parsed.session !== (ctx.sessionBinding ?? '') || now < parsed.issued || now - parsed.issued > 600_000) throw new CloudError('permission');
  return ctx.db.connectionRecords.atomic(() => {
    const pending = PendingSchema.parse(JSON.parse(readVaultValue(ctx, slot(id, 'pending')) ?? 'null'));
    if (pending.state !== state) throw new CloudError('permission');
    revokeVaultValue(ctx, slot(id, 'pending'));
    return { ...pending, pendingVersion: version(ctx, slot(id, 'pending')) };
  });
}
function tokenBody(p: Provider) {
  const body = new URLSearchParams({ [p.clientName ?? 'client_id']: process.env[`${p.env}_CLIENT_ID`] ?? '' });
  if (p.id !== 'etsy') body.set('client_secret', process.env[`${p.env}_CLIENT_SECRET`] ?? '');
  return body;
}
export function etsyAppHeaders(): Record<string, string> {
  const client = process.env.OMEGA_ETSY_CLIENT_ID, secret = process.env.OMEGA_ETSY_CLIENT_SECRET;
  if (!client || !secret) throw new CloudError('setup');
  return { 'x-api-key': `${client}:${secret}` };
}
function tokenHeaders(p: Provider): Record<string, string> {
  return { 'Content-Type': 'application/x-www-form-urlencoded', ...(p.id === 'etsy' ? etsyAppHeaders() : {}) };
}
export async function completeAuthorization(ctx: AuthContext, id: string, code: string, state: string, fetcher: typeof fetch = fetch, reauthorize: () => Promise<void> = async () => {}) {
  if (!code || code.length > 4096 || !providerReady(id)) throw new CloudError('setup');
  const pending = consumeAuthorization(ctx, id, state), p = cloudProvider(id);
  const body = tokenBody(p); body.set('grant_type', 'authorization_code'); body.set('code', code); body.set('redirect_uri', callbackUrl(id)); if (p.pkce) body.set('code_verifier', pending.verifier);
  const result = TokenResponse.parse(await cloudJson(p.token, { method: 'POST', headers: tokenHeaders(p), body: body.toString() }, fetcher));
  await reauthorize();
  if (version(ctx, slot(id, 'pending')) !== pending.pendingVersion || version(ctx, slot(id)) !== pending.tokenVersion) throw new CloudError('changed');
  saveVaultValue(ctx, slot(id), JSON.stringify({ access: result.access_token, refresh: result.refresh_token, expires: Date.now() + result.expires_in * 1000, generation: randomUUID() }));
}
export function oauthGeneration(ctx: VaultContext, id: string) {
  const value = readVaultValue(ctx, slot(id)); return value ? TokensSchema.parse(JSON.parse(value)).generation : '';
}
const refreshes = new Map<string, Promise<string>>();
export async function accessFor(ctx: VaultContext, id: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const value = readVaultValue(ctx, slot(id)); if (!value) throw new CloudError('permission');
  const tokens = TokensSchema.parse(JSON.parse(value));
  if (tokens.expires > Date.now() + 60_000) return tokens.access;
  const p = cloudProvider(id); if (!p.refresh || !tokens.refresh || !providerReady(id)) throw new CloudError('permission');
  const key = `${ctx.workspace.id}:${id}:${tokens.generation}`;
  const current = refreshes.get(key); if (current) return current;
  const work = (async () => {
    const originalVersion = version(ctx, slot(id));
    const body = tokenBody(p); body.set('grant_type', 'refresh_token'); body.set('refresh_token', tokens.refresh!);
    const next = TokenResponse.parse(await cloudJson(p.token, { method: 'POST', headers: tokenHeaders(p), body: body.toString(), signal }, fetcher));
    signal.throwIfAborted();
    if (version(ctx, slot(id)) !== originalVersion) throw new CloudError('changed');
    const updated = { ...tokens, access: next.access_token, refresh: next.refresh_token ?? tokens.refresh, expires: Date.now() + next.expires_in * 1000 };
    saveVaultValue(ctx, slot(id), JSON.stringify(updated)); return updated.access;
  })();
  refreshes.set(key, work);
  try { return await work; } finally { if (refreshes.get(key) === work) refreshes.delete(key); }
}
export function disconnectOAuth(ctx: VaultContext, id: string) {
  revokeVaultValue(ctx, slot(id));
  // Changing the pending envelope also invalidates an exchange already in flight.
  saveVaultValue(ctx, slot(id, 'pending'), JSON.stringify({ cancelled: true })); revokeVaultValue(ctx, slot(id, 'pending'));
}
