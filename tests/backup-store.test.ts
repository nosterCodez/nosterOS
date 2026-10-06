import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { LocalDirBackupStore, S3BackupStore, configuredStore } from '@/lib/backup/store';
import { MAX_ARCHIVE_BYTES } from '@/lib/backup/package';
import { encryptArchive } from '@/lib/backup/archive';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const name = 'omegaos-2026-10-05-abcdef12.tar.gz';
test('local store accepts only encrypted archives; round-trip, list, delete; no overwrite or traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omega-backup-store-')); dirs.push(root);
  const store = new LocalDirBackupStore(root, 'development');
  const bytes = encryptArchive(Buffer.from('fixture'), randomBytes(32));
  await store.put(name, bytes);
  expect(await store.get(name)).toEqual(bytes);
  expect(await readFile(path.join(root, name))).toEqual(bytes);
  expect(await store.list()).toEqual([{ name, bytes: bytes.length }]);
  await expect(store.put(name, bytes)).rejects.toThrow();
  await expect(store.put('omegaos-2026-10-06-abcdef12.tar.gz', Buffer.from('plain'))).rejects.toThrow();
  for (const bad of ['../escape', '/tmp/a', 'staging/' + name, '..\\escape', '.env.local']) {
    await expect(store.get(bad)).rejects.toThrow();
    await expect(store.delete(bad)).rejects.toThrow();
  }
  await store.delete(name); expect(await store.list()).toEqual([]);
  expect(() => new LocalDirBackupStore(root, 'production')).toThrow();
});
test('S3 store namespaces every operation and refuses malformed input', async () => {
  const bytes = encryptArchive(Buffer.from('fixture'), randomBytes(32));
  const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [{ Key: `staging/${name}`, Size: bytes.length }, { Key: `production/${name}`, Size: 8 }] };
    if (command.constructor.name === 'GetObjectCommand') return { ContentLength: bytes.length, Body: (async function* () { yield bytes; })() };
    return {};
  });
  const store = new S3BackupStore({ bucket: 'fixture', prefix: 'staging/', client: { send } });
  await store.put(name, bytes); expect(await store.get(name)).toEqual(bytes);
  expect(await store.list()).toEqual([{ name, bytes: bytes.length }]); await store.delete(name);
  for (const [command, options] of send.mock.calls as unknown as [any, any][]) {
    expect(command.input.Bucket).toBe('fixture');
    expect(command.input.Key ?? command.input.Prefix).toMatch(/^staging\//);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  }
  expect((send.mock.calls[0][0] as any).input.IfNoneMatch).toBe('*');
  await expect(store.put('../bad', bytes)).rejects.toThrow();
  await expect(store.put(name, Buffer.from('plaintext'))).rejects.toThrow();
  expect(() => new S3BackupStore({ bucket: 'fixture', prefix: '../', client: { send } })).toThrow();
});
test('S3 listing follows continuation tokens and fails closed on repeating tokens', async () => {
  const send = vi.fn().mockResolvedValueOnce({ IsTruncated: true, NextContinuationToken: 'next', Contents: [{ Key: `production/${name}`, Size: 64 }] })
    .mockResolvedValueOnce({ IsTruncated: false, Contents: [] });
  const store = new S3BackupStore({ bucket: 'fixture', prefix: 'production/', client: { send } });
  expect(await store.list()).toHaveLength(1);
  expect(send.mock.calls[1][0].input.ContinuationToken).toBe('next');
  send.mockReset().mockResolvedValue({ IsTruncated: true, NextContinuationToken: 'same' });
  await expect(store.list()).rejects.toThrow('Incomplete'); expect(send).toHaveBeenCalledTimes(2);
});
test('S3 reads reject excessive declared bodies and malformed ciphertext; config refuses missing/HTTP endpoints', async () => {
  const body = { [Symbol.asyncIterator]: vi.fn() };
  const send = vi.fn().mockResolvedValue({ ContentLength: MAX_ARCHIVE_BYTES + 33, Body: body });
  const store = new S3BackupStore({ bucket: 'fixture', prefix: 'staging/', client: { send } });
  await expect(store.get(name)).rejects.toThrow(); expect(body[Symbol.asyncIterator]).not.toHaveBeenCalled();
  send.mockResolvedValue({ Body: (async function* () { yield Buffer.from('plaintext'); })() });
  await expect(store.get(name)).rejects.toThrow('Encrypted');
  expect(() => configuredStore({}, 'production')).toThrow('not configured');
  expect(() => configuredStore({ OMEGA_BACKUP_S3_ENDPOINT: 'http://storage.example.com', OMEGA_BACKUP_S3_BUCKET: 'fixture',
    OMEGA_BACKUP_S3_ACCESS_KEY_ID: 'fixture', OMEGA_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture', OMEGA_BACKUP_S3_REGION: 'fixture' }, 'production')).toThrow('endpoint');
});
