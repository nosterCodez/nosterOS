import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { saveCredential, saveVaultValue } from '@/lib/creds';
import { collectCloud } from '@/lib/cloud-adapters';
const imap = vi.hoisted(() => ({ options: vi.fn(), connect: vi.fn(), status: vi.fn(), close: vi.fn() }));
vi.mock('imapflow', () => ({ ImapFlow: class { constructor(options: unknown) { imap.options(options); } on() {} connect = imap.connect; status = imap.status; close = imap.close; } }));
let db: ReturnType<typeof openDb>;
const ctx = () => ({ workspace: { id: 'A'.repeat(32) }, db });
const opts = (body: unknown) => ({ now: new Date('2026-10-05T00:00:00Z'), signal: AbortSignal.timeout(5000), fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)) });
function token(id: string) { saveVaultValue(ctx(), `oauth:${id}:tokens`, JSON.stringify({ access: 'fixture', expires: Date.now() + 3600000, generation: 'fixture' })); }
beforeEach(() => { db = openDb(':memory:'); vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex')); });
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
test('social fixtures preserve missing and zero counts; Etsy verifies selected shop', async () => {
  token('meta'); vi.stubEnv('OMEGA_META_API_VERSION', 'v26.0');
  expect((await collectCloud(ctx(), 'facebook', '123', opts({ followers_count: 0 }))).values).toEqual({ followers: 0, likes: null });
  expect((await collectCloud(ctx(), 'instagram', '123', opts({ followers_count: 2, media_count: 0 }))).values).toEqual({ followers: 2, media: 0 });
  token('tiktok');
  expect((await collectCloud(ctx(), 'tiktok', '', opts({ data: { user: { follower_count: 0, video_count: 3 } }, error: { code: 'ok' } }))).values).toEqual({ followers: 0, videos: 3, likes: null });
  token('etsy'); vi.stubEnv('OMEGA_ETSY_CLIENT_ID', 'fixture'); vi.stubEnv('OMEGA_ETSY_CLIENT_SECRET', 'fixture-secret');
  const options = opts({ shop_id: 123, listing_active_count: 0 });
  expect((await collectCloud(ctx(), 'etsy', '123', options)).values).toEqual({ sales: null, listings: 0 });
  expect(options.fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'fixture:fixture-secret' });
  await expect(collectCloud(ctx(), 'etsy', '456', opts({ shop_id: 123 }))).rejects.toThrow('invalid_data');
});
test('email uses verified TLS, reads counts only, closes socket and rejects custom hosts', async () => {
  saveCredential(ctx(), 'INBOX_1_HOST', 'imap.gmail.com'); saveCredential(ctx(), 'INBOX_1_USER', 'fixture@example.com'); saveCredential(ctx(), 'INBOX_1_PASS', 'fixture-password');
  imap.connect.mockResolvedValue(undefined); imap.status.mockResolvedValue({ messages: 0 });
  const result = await collectCloud(ctx(), 'email', '', opts({}));
  expect(result.values).toEqual({ messages: 0, unread: null });
  expect(imap.options).toHaveBeenCalledWith(expect.objectContaining({ port: 993, secure: true, logger: false, tls: { rejectUnauthorized: true } }));
  expect(imap.status).toHaveBeenCalledWith('INBOX', { messages: true, unseen: true });
  expect(imap.close).toHaveBeenCalledOnce();
  imap.options.mockClear(); saveCredential(ctx(), 'INBOX_1_HOST', '127.0.0.1');
  await expect(collectCloud(ctx(), 'email', '', opts({}))).rejects.toThrow('setup');
  expect(imap.options).not.toHaveBeenCalled();
});
