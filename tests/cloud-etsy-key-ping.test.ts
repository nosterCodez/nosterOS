import { expect, test, vi } from 'vitest';
import { cloudJson, CloudError, etsyKeyPing } from '@/lib/cloud-http';

const headers = { 'x-api-key': 'fixture-key:fixture-secret', Authorization: 'Bearer must-not-send', Cookie: 'must-not-send' };
test('key-only ping uses one fixed GET, key only, no redirect and discards success body', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe('https://api.etsy.com/v3/application/openapi-ping');
    expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error'); expect(init?.cache).toBe('no-store');
    expect([...new Headers(init?.headers)]).toEqual([['x-api-key', 'fixture-key:fixture-secret']]);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ application_id: 'never-return' });
  });
  expect(await etsyKeyPing(headers, fetcher)).toEqual({ httpStatus: 200, errorFields: [] });
  expect(fetcher).toHaveBeenCalledOnce();
});

test.each([
  [{ error: 'Refused' }, ['error'], 'Refused'],
  [{ error_description: 'App refused' }, ['error_description'], 'App refused'],
  [{ error: 'invalid_api_key', error_description: 'App refused' }, ['error', 'error_description'], 'invalid_api_key; App refused'],
  [{ error: { raw: 'discard' }, error_description: 1 }, ['error', 'error_description'], undefined],
  [{ message: 'discard' }, [], undefined],
] as const)('ping records approved JSON field presence and strings only: %j', async (body, fields, message) => {
  const result = await etsyKeyPing(headers, async () => Response.json(body, { status: 403 }));
  expect(result.httpStatus).toBe(403); expect(result.errorFields).toEqual(fields);
  expect(result.diagnostic?.errorFields).toEqual(fields); expect(result.diagnostic?.message).toBe(message);
  expect(JSON.stringify(result)).not.toContain('discard');
});

test('both error fields share masking and the 160-character cap in ping and normal requests', async () => {
  const body = { error: 'Denied fixture-key', error_description: 'fixture-secret private@example.test 12345678 ' + 'x'.repeat(200), secret: 'discard' };
  const fetcher = async () => Response.json(body, { status: 403 });
  const ping = await etsyKeyPing(headers, fetcher);
  const failure = await cloudJson('https://api.etsy.com/v3/application/users/me', { headers }, fetcher).catch(e => e);
  expect(failure).toBeInstanceOf(CloudError);
  if (!(failure instanceof CloudError)) throw new Error('Expected CloudError');
  expect(failure.diagnostic).toEqual(ping.diagnostic);
  expect(ping.diagnostic?.message).toHaveLength(160);
  expect(ping.diagnostic?.message).toContain('[redacted]; [redacted] [email] [number]');
  expect(JSON.stringify(ping)).not.toMatch(/fixture-|@|12345678|discard/);
});

test.each(['<html>private@example.test</html>', JSON.stringify({ error_description: 'x'.repeat(70000) }), 'null', '[]'])('unreadable or non-object response is not reported as missing fields', async body => {
  const result = await etsyKeyPing(headers, async () => new Response(body, { status: 403 }));
  expect(result.errorFields).toBeNull(); expect(result.diagnostic?.message).toBeUndefined();
  expect(result.diagnostic?.errorFields).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('private');
});

test('missing key or network failure does not fabricate an Etsy HTTP status', async () => {
  const fetcher = vi.fn(async () => { throw new Error('fixture-secret'); });
  await expect(etsyKeyPing({}, fetcher)).rejects.toThrow('setup'); expect(fetcher).not.toHaveBeenCalled();
  await expect(etsyKeyPing(headers, fetcher)).rejects.toThrow('provider');
});
