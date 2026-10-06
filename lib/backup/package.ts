import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pack, extract } from 'tar-stream';
import { z } from 'zod';

export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const DatabaseName = z.string().max(1024).refine(name => {
  const parts = name.split('/');
  // Portable path segments: no traversal, Windows streams or ambiguous trailing dots/spaces.
  if (!name.endsWith('.db') || parts.some(part => !part || part === '.' || part === '..'
    || /[\\:\x00-\x1f\x7f<>"|?*]/.test(part) || /[. ]$/.test(part))) return false;
  return parts.length === 1 || (parts[0] === 'platform' && parts.length > 1)
    || /^workspaces\/[A-Za-z0-9]{32}\/[A-Za-z0-9_-]+\.db$/.test(name);
}, 'Unexpected database path');
const FileRecord = z.object({ name: DatabaseName, size: z.number().int().nonnegative().max(MAX_ARCHIVE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), schemaVersion: z.number().int().nonnegative() }).strict();
const Manifest = z.object({ version: z.literal(1), appCommit: z.string().regex(/^[a-f0-9]{7,40}$/),
  files: z.array(FileRecord).min(1).max(4096) }).strict();
export type Snapshot = { name: string; bytes: Buffer; schemaVersion: number };
function hash(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
export function buildManifest(files: Snapshot[], appCommit: string) {
  const manifest = Manifest.parse({ version: 1, appCommit, files: files.map(file => ({
    name: file.name, size: file.bytes.length, sha256: hash(file.bytes), schemaVersion: file.schemaVersion,
  })) });
  if (!manifest.files.some(file => file.name === 'control.db') || new Set(files.map(file => file.name)).size !== files.length
    || files.reduce((total, file) => total + file.bytes.length, 0) > MAX_ARCHIVE_BYTES) throw new Error('Invalid backup manifest');
  return manifest;
}
export async function packArchive(files: Snapshot[], appCommit: string): Promise<Buffer> {
  const manifest = buildManifest(files, appCommit);
  const stream = pack();
  stream.entry({ name: 'manifest.json', type: 'file', mode: 0o600 }, JSON.stringify(manifest));
  for (const file of files) stream.entry({ name: file.name, type: 'file', mode: 0o600 }, file.bytes);
  stream.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid archive stream');
    chunks.push(chunk);
  }
  const result = gzipSync(Buffer.concat(chunks));
  if (result.length > MAX_ARCHIVE_BYTES) throw new Error('Backup archive exceeds size limit');
  return result;
}
/** Parse only regular allowlisted files in memory; never extract arbitrary tar paths. */
export async function unpackArchive(archive: Buffer) {
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('Backup archive exceeds size limit');
  const plain = gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE_BYTES + 8 * 1024 * 1024 });
  const stream = extract();
  const entries = new Map<string, Buffer>();
  const read = (async () => {
    try {
      for await (const entry of stream) {
        const { name, type, size = 0 } = entry.header;
        if (type !== 'file' || entries.has(name) || entries.size >= 4097 || size > MAX_ARCHIVE_BYTES
          || (name !== 'manifest.json' && !DatabaseName.safeParse(name).success)
          || (name === 'manifest.json' && size > 1024 * 1024)) throw new Error('Invalid backup entry');
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of entry) {
          if (!Buffer.isBuffer(chunk)) throw new Error('Invalid archive stream');
          bytes += chunk.length; if (bytes > size) throw new Error('Invalid backup size'); chunks.push(chunk);
        }
        if (bytes !== size) throw new Error('Invalid backup size');
        entries.set(name, Buffer.concat(chunks));
      }
    } finally { stream.destroy(); }
  })();
  stream.end(plain);
  await read;
  const manifest = Manifest.parse(JSON.parse(entries.get('manifest.json')?.toString('utf8') ?? 'null'));
  if (entries.size !== manifest.files.length + 1 || new Set(manifest.files.map(file => file.name)).size !== manifest.files.length
    || !manifest.files.some(file => file.name === 'control.db')) throw new Error('Invalid backup manifest');
  const files = manifest.files.map(file => {
    const bytes = entries.get(file.name);
    if (!bytes || bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error('Backup hash mismatch');
    return { name: file.name, bytes, schemaVersion: file.schemaVersion };
  });
  return { manifest, files };
}
