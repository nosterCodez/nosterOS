import { createHash } from 'node:crypto';
import type { VaultContext } from '@/lib/creds';
import { connectionField } from '@/lib/connection-fields';
import { EMAIL_FIELDS, type VerificationStatus } from '@/lib/verification-types';

export function verificationFields(name: string): readonly string[] { return name === 'email' ? EMAIL_FIELDS : [connectionField(name).name]; }
export function verificationName(name: string) { return (EMAIL_FIELDS as readonly string[]).includes(name) ? 'email' : name; }
export function verificationGeneration(ctx: VaultContext, name: string) {
  return createHash('sha256').update(JSON.stringify(verificationFields(name).map(field => ctx.db.connectionRecords.get(field)))).digest('hex');
}
export function verificationState(ctx: VaultContext, name: string) {
  const fields = verificationFields(name), records = fields.map(field => ctx.db.connectionRecords.get(field));
  const active = records.filter(row => row && !row.revokedAt).length;
  const row = ctx.db.connectionVerifications.get(name);
  const current = row?.generation === verificationGeneration(ctx, name) ? row : undefined;
  const status: VerificationStatus = !active ? records.some(Boolean) ? 'revoked' : 'not_configured' : active < fields.length ? 'incomplete' : current?.result?.status ?? 'unverified';
  return { status, checkedAt: current?.checkedAt ?? null, verifiedAt: current?.verifiedAt ?? null, ...(current?.result?.note ? { note: current.result.note } : {}) };
}
