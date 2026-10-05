import { createHash } from 'node:crypto';
import { CLOUD_SOURCES, cloudSource } from '@/lib/cloud-catalog';
import { oauthGeneration, providerReady } from '@/lib/cloud-oauth';
import { type VaultContext, resolveCred } from '@/lib/creds';
import { CloudError } from '@/lib/cloud-http';
import type { CloudSnapshot } from '@/lib/cloud-records';
import { printifyCredential, PRINTIFY_RECONNECT } from '@/lib/printify-credentials';

export function credentialVersion(ctx: VaultContext, id: string): string {
  const source = cloudSource(id);
  if (id === 'printify') return printifyCredential(ctx).generation;
  if (source.provider) return oauthGeneration(ctx, source.provider);
  const fields = id === 'stripe' ? ['STRIPE_SECRET_KEY'] : id === 'email' ? ['INBOX_1_HOST', 'INBOX_1_USER', 'INBOX_1_PASS'] : [];
  if (!fields.length || fields.some(name => !resolveCred(ctx, name))) return '';
  return createHash('sha256').update(JSON.stringify(fields.map(name => ctx.db.connectionRecords.get(name)))).digest('hex');
}
export function configureSource(ctx: VaultContext, id: string, input: { resource: string; enabled: boolean }) {
  const source = cloudSource(id), resource = input.resource.trim();
  if (source.planned || resource.length > 500 || (source.resourcePattern && !new RegExp(source.resourcePattern).test(resource))) throw new CloudError('setup');
  const generation = credentialVersion(ctx, id), previous = ctx.db.cloudSources.get(id);
  if (id === 'printify' && previous?.error === PRINTIFY_RECONNECT && previous.credentialVersion === generation) throw new CloudError('authentication');
  ctx.db.cloudSources.configure(id, resource, input.enabled, generation);
}
export function sourceView(ctx: VaultContext, id: string, now = Date.now()) {
  const source = cloudSource(id), record = ctx.db.cloudSources.get(id);
  let generation = ''; let vaultError = false;
  try { generation = credentialVersion(ctx, id); } catch { vaultError = true; }
  const matches = Boolean(generation && generation === record?.credentialVersion);
  const snapshot: CloudSnapshot | null = matches ? record?.snapshot ?? null : null;
  const stale = Boolean(snapshot && (record?.error || now - Date.parse(snapshot.at) > 2 * 15 * 60_000));
  const status = source.planned ? 'planned' : vaultError ? 'vault_unavailable' : !generation ? 'not_connected' : !record || !matches ? 'needs_setup' : id === 'printify' && record.error === PRINTIFY_RECONNECT ? 'error' : !record.enabled ? 'paused' : record.error ? 'error' : snapshot ? stale ? 'stale' : 'connected' : 'ready';
  return { ...source, resource: record?.resource ?? '', enabled: record?.enabled ?? false, status, stale, snapshot, error: matches ? record?.error ?? null : null,
    connectionMethod: id === 'printify' && !vaultError ? printifyCredential(ctx).method : null,
    appReady: source.provider ? providerReady(source.provider) : true, lastAttempt: matches ? record?.lastAttempt ?? null : null };
}
export function sourceViews(ctx: VaultContext) { return CLOUD_SOURCES.map(s => sourceView(ctx, s.id)); }
export type CloudSourceView = ReturnType<typeof sourceView>;
