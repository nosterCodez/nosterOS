import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FounderDb } from '@/lib/db';
import type { Envelope } from '@/lib/connection-records';
import { CONNECTION_FIELDS, connectionField, type ConnectionMetadata } from '@/lib/connection-fields';
import { OAUTH_IDS } from '@/lib/cloud-catalog';

export type VaultContext = { workspace: { id: string }; db: FounderDb };
type Context = VaultContext;
function privateField(name: string) {
  if (OAUTH_IDS.some(id => name === `oauth:${id}:tokens` || name === `oauth:${id}:pending`)) return;
  connectionField(name);
}
export class VaultError extends Error { constructor() { super('Connection vault unavailable'); } }
function masterKey() {
  const value = process.env.NOSTEROS_MASTER_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new VaultError();
  return Buffer.from(value, 'hex');
}
function aad(context: Context, purpose: string) {
  if (!/^[A-Za-z0-9]{32}$/.test(context.workspace.id)) throw new VaultError();
  return Buffer.from(JSON.stringify(['OmegaOS', 1, context.workspace.id, purpose]));
}
function encrypt(key: Buffer, value: Buffer, associated: Buffer): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(associated);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function decrypt(key: Buffer, envelope: Envelope, associated: Buffer) {
  const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
  if (envelope.version !== 1 || iv.length !== 12 || tag.length !== 16) throw new VaultError();
  const cipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(associated); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]);
}
function withDataKey<T>(context: Context, create: boolean, work: (key: Buffer | undefined) => T): T {
  const master = masterKey(); let key: Buffer | undefined;
  try {
    const associated = aad(context, 'workspace-data-key');
    const record = context.db.connectionRecords.key();
    const keyId = createHash('sha256').update(master).digest('hex');
    if (record) {
      if (record.keyId !== keyId) throw new VaultError();
      key = decrypt(master, record.envelope, associated);
      if (key.length !== 32) throw new VaultError();
    } else if (create) {
      key = randomBytes(32);
      context.db.connectionRecords.createKey({ keyId, envelope: encrypt(master, key, associated) });
    }
    return work(key);
  } catch { throw new VaultError(); }
  finally { key?.fill(0); master.fill(0); }
}
export function vaultReady(context: Context): boolean {
  try { return withDataKey(context, false, () => true); } catch { return false; }
}
export function connectionMetadata(context: Context): ConnectionMetadata[] {
  const rows = context.db.connectionRecords.all();
  return CONNECTION_FIELDS.map(field => {
    const row = rows.find(row => row.name === field.name);
    return { ...field, status: !row ? 'not_configured' : row.revokedAt ? 'revoked' : 'saved', updatedAt: row?.updatedAt ?? null };
  });
}
export function saveCredential(context: Context, name: string, value: string): void {
  connectionField(name);
  if (!value.trim() || value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error('Invalid connection value');
  if (name === 'STRIPE_SECRET_KEY' && !/^rk_(test|live)_/.test(value)) throw new Error('Use a Stripe restricted key');
  saveVaultValue(context, name, value.trim());
}
/** Server-only slots; public credential routes must continue using saveCredential. */
export function saveVaultValue(context: Context, name: string, value: string): void {
  privateField(name);
  if (!value || value.length > 32768) throw new VaultError();
  context.db.connectionRecords.atomic(() => withDataKey(context, true, key => {
    const plaintext = Buffer.from(value.trim());
    try { context.db.connectionRecords.put({ name, envelope: encrypt(key!, plaintext, aad(context, name)), updatedAt: new Date().toISOString(), revokedAt: null }); }
    finally { plaintext.fill(0); }
  }));
}
/** No env/file fallback and no cache: replacement/revocation takes effect on the next read. */
export function resolveCred(context: Context, name: string): string | undefined {
  connectionField(name);
  return readVaultValue(context, name);
}
export function readVaultValue(context: Context, name: string): string | undefined {
  privateField(name);
  const row = context.db.connectionRecords.get(name);
  if (!row || row.revokedAt) return undefined;
  return withDataKey(context, false, key => {
    if (!key) throw new VaultError();
    const plaintext = decrypt(key, row.envelope, aad(context, name));
    try { return plaintext.toString('utf8'); } finally { plaintext.fill(0); }
  });
}
export function revokeCredential(context: Context, name: string): void {
  connectionField(name);
  if (name === 'PRINTIFY_API_TOKEN') {
    aad(context, name);
    context.db.connectionRecords.atomic(() => {
      context.db.connectionRecords.remove(name);
      // Also supersedes validation/collection in flight, including a first save.
      context.db.cloudSources.configure('printify', context.db.cloudSources.get('printify')?.resource ?? '', false, '');
    });
  } else revokeVaultValue(context, name);
}
export function revokeVaultValue(context: Context, name: string): void {
  privateField(name); aad(context, name);
  context.db.connectionRecords.atomic(() => {
    const row = context.db.connectionRecords.get(name);
    if (row && !row.revokedAt) context.db.connectionRecords.put({ ...row, revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
}
