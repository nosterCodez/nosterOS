import { CONNECTION_FIELDS, connectionField } from '@/lib/connection-fields';
import { resolveCred, saveCredential, validateCredential, vaultReady, VaultError, type VaultContext } from '@/lib/creds';
import { probeEmail, probeKey } from '@/lib/credential-probes';
import { EMAIL_FIELDS, IMAP_HOSTS, VERIFICATION_PAUSED, VERIFICATION_REJECTED, type EmailInput, type VerificationResult } from '@/lib/verification-types';
import { verificationFields, verificationGeneration, verificationState } from '@/lib/verification-state';
import { printifyCredential, PRINTIFY_TOKEN_REJECTED, PRINTIFY_UNREACHABLE } from '@/lib/printify-credentials';

export class VerificationError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export function emailDefaults(ctx: VaultContext): Omit<EmailInput, 'password'> {
  try { return { host: resolveCred(ctx, 'INBOX_1_HOST') ?? '', account: resolveCred(ctx, 'INBOX_1_USER') ?? '' }; }
  catch { return { host: '', account: '' }; }
}
type Options = { value?: string; email?: EmailInput; daily?: boolean; now?: number; signal?: AbortSignal; reauthorize?: () => Promise<void> };
function pauseRejected(ctx: VaultContext, name: string) {
  const source = name === 'email' ? 'email' : name === 'STRIPE_SECRET_KEY' ? 'stripe' : name === 'PRINTIFY_API_TOKEN' && printifyCredential(ctx).method === 'Personal token' ? 'printify' : null;
  if (source) ctx.db.cloudSources.pauseRejected(source, VERIFICATION_PAUSED);
}
export async function verifyCredential(ctx: VaultContext, name: string, options: Options = {}): Promise<VerificationResult | null> {
  const fields = verificationFields(name), saving = options.value !== undefined || options.email !== undefined;
  if (name !== 'email' && (EMAIL_FIELDS as readonly string[]).includes(name)) throw new VerificationError('Save email host, account and password together.');
  if (!vaultReady(ctx)) throw new VaultError();
  let email: EmailInput | undefined, value: string | undefined;
  if (name === 'email') {
    email = options.email ?? { ...emailDefaults(ctx), password: resolveCred(ctx, 'INBOX_1_PASS') ?? '' };
    email = { host: email.host.trim(), account: email.account.trim(), password: email.password.trim() };
    const incomplete = !IMAP_HOSTS.includes(email.host) || !email.account || !email.password;
    if (incomplete) {
      if (saving) throw new VerificationError('Complete email host, account and app password.');
    }
    if (!incomplete) for (const [i, part] of [email.host, email.account, email.password].entries()) validateCredential(EMAIL_FIELDS[i], part);
  } else {
    value = options.value ?? resolveCred(ctx, name);
    if (!value) throw new VerificationError('Save credentials before verifying.');
    validateCredential(name, value);
  }
  const now = options.now ?? Date.now(), repo = ctx.db.connectionVerifications;
  if (!options.daily && !repo.takeManual(now)) throw new VerificationError('Wait one minute. This workspace allows five checks per minute.', 429);
  const before = verificationGeneration(ctx, name), claim = repo.claim(name, before, now, options.daily);
  if (!claim) { if (options.daily) return null; throw new VerificationError('A check is already running. Try again shortly.', 409); }
  try {
    const result = email ? await probeEmail(email, options) : await probeKey(connectionField(name).provider, value!, options);
    await options.reauthorize?.();
    if (before !== verificationGeneration(ctx, name) || !repo.owns(name, claim)) throw new VerificationError('Connection changed. Reload Connections before saving.', 409);
    if (saving && name === 'PRINTIFY_API_TOKEN' && result.status !== 'verified') throw new VerificationError(result.status === 'rejected' ? PRINTIFY_TOKEN_REJECTED : PRINTIFY_UNREACHABLE);
    if (saving && result.status === 'rejected') throw new VerificationError(VERIFICATION_REJECTED);
    ctx.db.connectionRecords.atomic(() => {
      if (saving) {
        if (email) [email.host, email.account, email.password].forEach((part, i) => saveCredential(ctx, fields[i], part));
        else saveCredential(ctx, name, value!);
      }
      repo.finish(name, claim, verificationGeneration(ctx, name), result, now);
      if (result.status === 'rejected') pauseRejected(ctx, name);
    });
    return result;
  } finally { repo.release(name, claim); }
}
export async function verifyDueCredentials(ctx: VaultContext, options: { now?: number; signal?: AbortSignal } = {}) {
  if (!vaultReady(ctx) || options.signal?.aborted) return;
  const names = [...CONNECTION_FIELDS.filter(f => f.provider !== 'email').map(f => f.name), 'email'];
  // One due credential per tick keeps the shared job budget bounded. Oldest checks run first.
  const due = names.filter(name => !['not_configured', 'revoked', 'incomplete'].includes(verificationState(ctx, name).status))
    .sort((a, b) => (ctx.db.connectionVerifications.get(a)?.attemptedAt ?? 0) - (ctx.db.connectionVerifications.get(b)?.attemptedAt ?? 0));
  for (const name of due) {
    if (options.signal?.aborted) break;
    try { if (await verifyCredential(ctx, name, { ...options, daily: true })) break; }
    catch { /* No provider text in logs; the persisted attempt prevents a daily retry loop. */ }
  }
}
