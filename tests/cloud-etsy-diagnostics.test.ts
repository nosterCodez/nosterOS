import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb } from '@/lib/db';
import { cloudJson, CloudError } from '@/lib/cloud-http';
import { etsyDiagnostic } from '@/lib/cloud-diagnostics';
import { etsyAppHeaders, disconnectOAuth } from '@/lib/cloud-oauth';
import { saveVaultValue } from '@/lib/creds';
import { sourceView, configureSource } from '@/lib/cloud-sources';
import { discoverResources } from '@/lib/cloud-resources';
import { syncSource } from '@/lib/cloud-jobs';

let db: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, db });
beforeEach(() => {
  db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', 'ab'.repeat(32));
  vi.stubEnv('OMEGA_ETSY_CLIENT_ID', 'fixture-keystring'); vi.stubEnv('OMEGA_ETSY_CLIENT_SECRET', 'fixture-shared-secret');
  saveVaultValue(ctx(), 'oauth:etsy:tokens', JSON.stringify({ access: '123.fixture-token', generation: 'fixture-generation', expires: Date.now() + 3600000 }));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test.each(['invalid_token', 'insufficient_scope', 'access_denied'])('Etsy HTTP errors preserve code and bounded error text for %s only', async code => {
  const fetcher = vi.fn(async () => Response.json({ error: code, message: 'private-reflected-token', user: 'private-personal-data' }, { status: 403 }));
  let failure: unknown;
  try { await cloudJson('https://api.etsy.com/v3/application/users/me', {}, fetcher); } catch (e) { failure = e; }
  expect(failure).toBeInstanceOf(CloudError);
  expect((failure as CloudError).diagnostic).toEqual({ provider: 'etsy', httpStatus: 403, code, message: code });
  expect(JSON.stringify(failure)).not.toContain('private-');
});

test('unknown codes remain categorized; malformed/oversized errors never retain their bodies', async () => {
  for (const error of ['secret', 'invalid_token secret', '__proto__', 'constructor', { token: 'secret' }]) expect(etsyDiagnostic(403, error).code).toBe('unrecognized_provider_error');
  for (const body of ['not-json secret', JSON.stringify({ error: 'secret'.repeat(12000) })]) {
    const failure = await cloudJson('https://api.etsy.com/v3/application/users/me', {}, async () => new Response(body, { status: 403 })).catch(e => e as CloudError);
    expect(failure).toBeInstanceOf(CloudError);
    expect((failure as CloudError).diagnostic).toEqual({ provider: 'etsy', httpStatus: 403, code: 'unrecognized_provider_error' });
    expect(JSON.stringify(failure)).not.toContain('secret');
  }
  expect(etsyDiagnostic(403, 'API key not found or not active, or incorrect shared secret for API key.').code).toBe('api_key_inactive_or_secret_mismatch');
});

test('Etsy error text masks complete emails and long digit runs before truncating to 160', () => {
  const detail = etsyDiagnostic(403, `Denied test+account@example.com 1234567 123456\n${'x'.repeat(200)} end@private.test`);
  expect(detail.message).toHaveLength(160);
  expect(detail.message).toMatch(/^Denied \[email\] \[number\] 123456 /);
  expect(detail.message).not.toMatch(/@|1234567|\n/);
  expect(etsyDiagnostic(403, 'x'.repeat(155) + ' person@example.com').message).not.toContain('pers');
  expect(etsyDiagnostic(403, { error: 'not a string' }).message).toBeUndefined();
  expect(etsyDiagnostic(403, 'x'.repeat(60000)).message).toBe('x'.repeat(160));
});

test('Etsy masks reflected authorization, app keys and token-exchange credentials', async () => {
  const headers = { Authorization: 'Bearer 123.private-token', 'x-api-key': 'private-key:private-secret' };
  const error = 'Denied 123.private-token private-token private-key:private-secret private-key private-secret refresh-value code-value verifier-value';
  const failure = await cloudJson('https://api.etsy.com/v3/public/oauth/token', { method: 'POST', headers, body: new URLSearchParams({ refresh_token: 'refresh-value', code: 'code-value', code_verifier: 'verifier-value' }).toString() }, async () => Response.json({ error, other: 'never echo' }, { status: 403 })).catch(e => e as CloudError);
  expect(failure).toBeInstanceOf(CloudError);
  expect((failure as CloudError).diagnostic?.message).toContain('[redacted]');
  expect(JSON.stringify(failure)).not.toMatch(/private-|refresh-value|code-value|verifier-value|never echo/);
});

test('non-Etsy providers never retain arbitrary diagnostic text', async () => {
  const failure = await cloudJson('https://graph.facebook.com/v26.0/me', {}, async () => Response.json({ error: 'private@example.test 12345678' }, { status: 403 })).catch(e => e as CloudError);
  expect(failure).toBeInstanceOf(CloudError);
  expect((failure as CloudError).diagnostic).toBeUndefined();
});

test('discovery uses keystring:secret and handles the single-shop object response', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe('https://api.etsy.com/v3/application/users/123/shops');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-keystring:fixture-shared-secret');
    return Response.json({ shop_id: 456, user_id: 123, shop_name: 'Fixture shop', private_extra: 'discard' });
  });
  expect(etsyAppHeaders()['x-api-key']).toBe('fixture-keystring:fixture-shared-secret');
  expect(await discoverResources(ctx(), 'etsy', fetcher)).toEqual({ resources: [{ id: '456', label: 'Fixture shop' }], truncated: false });
});

test('lastError stays out of default views and is hidden after disconnect or generation change', () => {
  const detail = etsyDiagnostic(403, 'access_denied');
  db.cloudSources.recordError('etsy', 'fixture-generation', 'Safe error', detail);
  expect(sourceView(ctx(), 'etsy').lastError).toBeUndefined();
  expect(sourceView(ctx(), 'etsy', Date.now(), true)).toMatchObject({ status: 'needs_setup', enabled: false, lastError: detail });
  disconnectOAuth(ctx(), 'etsy');
  expect(sourceView(ctx(), 'etsy', Date.now(), true).lastError).toBeNull();
});

test('an error recorded before account selection does not become configured on reauthorization', () => {
  db.cloudSources.recordError('etsy', 'fixture-generation', 'Safe error', etsyDiagnostic(403, 'access_denied'));
  db.cloudSources.reauthorize('etsy', 'fixture-generation');
  expect(sourceView(ctx(), 'etsy', Date.now(), true)).toMatchObject({ status: 'needs_setup', enabled: false, resource: '', lastError: null });
});

test('collector persists/logs sanitized Etsy detail with workspace id', async () => {
  configureSource(ctx(), 'etsy', { resource: '456', enabled: true });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const detail = etsyDiagnostic(403, 'Denied private@example.test 123456789');
  await syncSource(ctx(), 'etsy', { collect: async () => { throw new CloudError('permission', detail); } });
  expect(sourceView(ctx(), 'etsy', Date.now(), true).lastError).toEqual(detail);
  expect(warning).toHaveBeenCalledWith('[cloud-provider-error]', { workspaceId: ctx().workspace.id, source: 'etsy', ...detail });
  expect(JSON.stringify(warning.mock.calls)).not.toContain('fixture-token');
  expect(JSON.stringify(warning.mock.calls)).not.toMatch(/private@example|123456789/);
});
