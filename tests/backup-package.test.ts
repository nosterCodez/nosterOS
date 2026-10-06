import { afterEach, expect, test, vi } from 'vitest';
import { pack } from 'tar-stream';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildManifest, packArchive, unpackArchive } from '@/lib/backup/package';

const fixtures = [{ name: 'control.db', bytes: Buffer.from('fixture control'), schemaVersion: 1 },
  { name: `workspaces/${'a'.repeat(32)}/nosteros.db`, bytes: Buffer.from('fixture workspace'), schemaVersion: 5 }];
afterEach(() => vi.unstubAllEnvs());
test('archive round trip verifies manifest sizes, hashes, commit and schema versions, never includes env', async () => {
  vi.stubEnv('NOSTEROS_MASTER_KEY', 'fixture-vault-value-not-for-archives');
  const archive = await packArchive(fixtures, 'abcdef12');
  const result = await unpackArchive(archive);
  expect(result.manifest).toEqual(buildManifest(fixtures, 'abcdef12'));
  expect(result.files).toEqual(fixtures);
  expect(gunzipSync(archive).includes(Buffer.from('OMEGA_BACKUP_KEY'))).toBe(false);
  expect(gunzipSync(archive).includes(Buffer.from('fixture-vault-value-not-for-archives'))).toBe(false);
  await expect(packArchive([{ ...fixtures[0], name: '.env.local' }], 'abcdef12')).rejects.toThrow();
  await expect(packArchive([...fixtures, fixtures[0]], 'abcdef12')).rejects.toThrow();
});
async function raw(entries: { name: string; bytes: Buffer; type?: 'file' | 'symlink' }[]) {
  const stream = pack();
  for (const entry of entries) stream.entry({ name: entry.name, type: entry.type ?? 'file', linkname: entry.type === 'symlink' ? '/etc/passwd' : undefined }, entry.bytes);
  stream.finalize(); const chunks: Buffer[] = []; for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid fixture stream'); chunks.push(chunk);
  }
  return gzipSync(Buffer.concat(chunks));
}
test('rejects manifest mismatch, missing/extra/duplicate entries, traversal and links', async () => {
  const manifest = { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(buildManifest(fixtures, 'abcdef12'))) };
  for (const entries of [
    [manifest, { ...fixtures[0], bytes: Buffer.from('tampered') }, fixtures[1]],
    [manifest, fixtures[0]], [manifest, ...fixtures, fixtures[0]],
    [manifest, ...fixtures, { name: '../outside.db', bytes: Buffer.from('x') }],
    [manifest, ...fixtures, { name: 'control.db', bytes: Buffer.alloc(0), type: 'symlink' as const }],
  ]) await expect(unpackArchive(await raw(entries))).rejects.toThrow();
  await expect(unpackArchive(Buffer.from('not gzip'))).rejects.toThrow();
});
