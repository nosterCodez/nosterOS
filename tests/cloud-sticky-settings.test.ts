import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { beginAuthorization, completeAuthorization, disconnectOAuth, oauthGeneration } from '@/lib/cloud-oauth';
import { configureSource, sourceView } from '@/lib/cloud-sources';
import { saveVaultValue } from '@/lib/creds';
import { syncSource } from '@/lib/cloud-jobs';
import { CloudError, CLOUD_ERROR_TEXT } from '@/lib/cloud-http';

let db: ReturnType<typeof openDb>, other: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, user: { id: 'user-a' }, db });
const selections = [
  { id: 'search-console', resource: 'sc-domain:example.test', enabled: true },
  { id: 'ga4', resource: '12345', enabled: true },
  { id: 'youtube', resource: 'UC' + 'x'.repeat(22), enabled: false },
];
const snapshot = { at: '2026-10-05T12:00:00.000Z', period: 'Fixture', values: { users: 12 } };
const tokenReply = () => Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 });
const state = () => new URL(beginAuthorization(ctx(), 'google').url).searchParams.get('state')!;
function disconnect() {
  disconnectOAuth(ctx(), 'google');
  for (const { id } of selections) db.cloudSources.invalidate(id);
}
beforeEach(() => {
  db = openDb(':memory:'); other = openDb(':memory:');
  vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('NOSTEROS_BASE_URL', 'http://localhost:4100');
  vi.stubEnv('OMEGA_GOOGLE_CLIENT_ID', 'fixture-client'); vi.stubEnv('OMEGA_GOOGLE_CLIENT_SECRET', 'fixture-secret');
  saveVaultValue(ctx(), 'oauth:google:tokens', JSON.stringify({ access: 'old-access', generation: 'old-generation', expires: Date.now() + 3600000 }));
  for (const selection of selections) configureSource(ctx(), selection.id, selection);
});
afterEach(() => { db.close(); other.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test('Google reauthorization carries all saved resources and opt-ins, snapshots and isolated workspace state', async () => {
  const initial = db.cloudSources.get('ga4')!;
  db.cloudSources.claim('ga4', initial.revision, 'old-claim', 1000);
  db.cloudSources.finish('ga4', initial.revision, 'old-claim', snapshot, 'old-error');
  const before = selections.map(s => db.cloudSources.get(s.id)!);
  other.cloudSources.configure('ga4', '999', true, 'other-generation');
  const otherBefore = other.cloudSources.get('ga4');
  await completeAuthorization(ctx(), 'google', 'fixture-code', state(), vi.fn(async () => tokenReply()));
  const generation = oauthGeneration(ctx(), 'google');
  expect(generation).not.toBe('old-generation');
  for (const [i, selection] of selections.entries()) {
    const row = db.cloudSources.get(selection.id)!;
    expect(row).toMatchObject({ ...selection, credentialVersion: generation, error: null, claim: null, claimUntil: 0 });
    expect(row.revision).not.toBe(before[i].revision);
    expect(row.snapshot).toEqual(before[i].snapshot);
    expect(row.lastAttempt).toBe(before[i].lastAttempt);
    expect(sourceView(ctx(), selection.id).status).not.toBe('needs_setup');
  }
  expect(other.cloudSources.get('ga4')).toEqual(otherBefore);
  expect(db.cloudSources.get('google-business')).toBeUndefined();
  expect(db.cloudSources.finish('ga4', initial.revision, 'old-claim', snapshot, null)).toBe(false);
});

test.each(['during exchange', 'after reauthorization'])('concurrent disconnect wins %s and never revives automatic reads', async phase => {
  const pending = state();
  const fetcher = vi.fn(async () => { if (phase === 'during exchange') disconnect(); return tokenReply(); });
  if (phase === 'during exchange') await expect(completeAuthorization(ctx(), 'google', 'fixture-code', pending, fetcher)).rejects.toThrow('changed');
  else { await completeAuthorization(ctx(), 'google', 'fixture-code', pending, fetcher); disconnect(); }
  expect(oauthGeneration(ctx(), 'google')).toBe('');
  for (const { id } of selections) expect(sourceView(ctx(), id)).toMatchObject({ enabled: false, status: 'not_connected' });
});

test('source carry-forward failure rolls back token and all source writes together', async () => {
  const oldTokens = db.connectionRecords.get('oauth:google:tokens');
  const rows = selections.map(s => db.cloudSources.get(s.id));
  const reauthorize = db.cloudSources.reauthorize;
  vi.spyOn(db.cloudSources, 'reauthorize').mockImplementation((id, generation) => {
    if (id === 'ga4') throw new Error('fixture failure');
    reauthorize(id, generation);
  });
  await expect(completeAuthorization(ctx(), 'google', 'fixture-code', state(), vi.fn(async () => tokenReply()))).rejects.toThrow('fixture failure');
  expect(db.connectionRecords.get('oauth:google:tokens')).toEqual(oldTokens);
  expect(selections.map(s => db.cloudSources.get(s.id))).toEqual(rows);
});

test('next read validates the retained resource; denied access pauses scheduling without losing last report', async () => {
  const old = db.cloudSources.get('ga4')!;
  db.cloudSources.claim('ga4', old.revision, 'claim', 1000);
  db.cloudSources.finish('ga4', old.revision, 'claim', snapshot, null);
  await completeAuthorization(ctx(), 'google', 'fixture-code', state(), vi.fn(async () => tokenReply()));
  const collect = vi.fn(async (_ctx, _id, resource) => { expect(resource).toBe('12345'); throw new CloudError('permission'); });
  const now = new Date();
  expect(await syncSource(ctx(), 'ga4', { collect, now })).toMatchObject({ ok: false, error: CLOUD_ERROR_TEXT.permission });
  expect(sourceView(ctx(), 'ga4')).toMatchObject({ resource: '12345', enabled: false, snapshot, error: CLOUD_ERROR_TEXT.permission });
  expect(await syncSource(ctx(), 'ga4', { collect, now: new Date(+now + 900001) })).toMatchObject({ skipped: 'paused' });
  expect(collect).toHaveBeenCalledOnce();
});

test('a late permission failure cannot pause a replacement authorization', async () => {
  const collect = vi.fn(async () => {
    await completeAuthorization(ctx(), 'google', 'fixture-code', state(), vi.fn(async () => tokenReply()));
    throw new CloudError('permission');
  });
  expect(await syncSource(ctx(), 'ga4', { collect })).toMatchObject({ ok: false });
  expect(sourceView(ctx(), 'ga4')).toMatchObject({ enabled: true, error: null, status: 'ready' });
});
