import { expect, test, vi } from 'vitest';
import { cloudJson, CLOUD_ERROR_TEXT } from '@/lib/cloud-http';

const url = 'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport';
const disabled = { error: { message: 'private-token provider text', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'googleapis.com', reason: 'SERVICE_DISABLED', metadata: { secret: 'private-token' } }] } };
const fetcher = (body: unknown, status: number) => vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));

test('disabled Google API is not an expired login and exposes only static guidance', async () => {
  await expect(cloudJson(url, {}, fetcher(disabled, 403))).rejects.toMatchObject({ code: 'api_disabled', message: 'api_disabled' });
  expect(CLOUD_ERROR_TEXT.api_disabled).toContain('administrator');
  expect(JSON.stringify(CLOUD_ERROR_TEXT)).not.toContain('private-token');
});

test('authentication and account permissions have distinct guidance', async () => {
  await expect(cloudJson(url, {}, fetcher({}, 401))).rejects.toMatchObject({ code: 'authentication' });
  await expect(cloudJson(url, {}, fetcher({}, 403))).rejects.toMatchObject({ code: 'permission' });
  expect(CLOUD_ERROR_TEXT.permission).not.toContain('expired');
});

test('only structured Google ErrorInfo on Google hosts is classified as disabled', async () => {
  for (const body of [{ error: { message: 'SERVICE_DISABLED' } }, { error: { details: [null, 'SERVICE_DISABLED', { reason: 'SERVICE_DISABLED' }] } }, null]) {
    await expect(cloudJson(url, {}, fetcher(body, 403))).rejects.toMatchObject({ code: 'permission' });
  }
  await expect(cloudJson('https://api.stripe.com/v1/charges', {}, fetcher(disabled, 403))).rejects.toMatchObject({ code: 'permission' });
  await expect(cloudJson(url, {}, fetcher(disabled, 429))).rejects.toMatchObject({ code: 'rate_limit' });
});

test('malformed and oversized error bodies retain safe permission fallback', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel });
  await expect(cloudJson(url, {}, vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 403 })))).rejects.toMatchObject({ code: 'permission' });
  expect(cancel).toHaveBeenCalledOnce();
  await expect(cloudJson(url, {}, vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>private-token</html>', { status: 403 })))).rejects.toMatchObject({ code: 'permission' });
});

test('Meta Graph error codes distinguish expired sign-in, permission and throttling without exposing messages', async () => {
  const graph = 'https://graph.facebook.com/v26.0/me/accounts';
  for (const [code, expected] of [[190, 'authentication'], [10, 'permission'], [200, 'permission'], [4, 'rate_limit'], [17, 'rate_limit'], [999, 'provider']] as const) {
    await expect(cloudJson(graph, {}, fetcher({ error: { code, message: 'private-token' } }, 400))).rejects.toMatchObject({ code: expected, message: expected });
  }
  await expect(cloudJson(url, {}, fetcher({ error: { code: 190 } }, 400))).rejects.toMatchObject({ code: 'provider' });
  await expect(cloudJson(graph, {}, fetcher({ error: { code: '190' } }, 400))).rejects.toMatchObject({ code: 'provider' });
});
