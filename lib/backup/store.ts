import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { MAX_ARCHIVE_BYTES } from '@/lib/backup/package';
import type { EnvMode } from '@/lib/env-mode';

export type BackupObject = { name: string; bytes: number };
export interface BackupStore {
  put(name: string, bytes: Buffer): Promise<void>;
  get(name: string): Promise<Buffer>;
  list(): Promise<BackupObject[]>;
  delete(name: string): Promise<void>;
}
export function archiveName(name: string) {
  if (!/^omegaos-\d{4}-\d{2}-\d{2}-[a-f0-9]{7,40}\.tar\.gz$/.test(name)) throw new Error('Invalid backup name');
  return name;
}
function encrypted(bytes: Buffer) {
  if (bytes.length < 32 || bytes.length > MAX_ARCHIVE_BYTES + 32 || bytes.subarray(0, 4).toString() !== 'OBK1') throw new Error('Encrypted backup required');
  return bytes;
}
export class LocalDirBackupStore implements BackupStore {
  constructor(private root: string, mode: EnvMode) {
    if (mode !== 'development' || process.env.OMEGA_ENV === 'production' || process.env.OMEGA_ENV === 'staging') throw new Error('Local backup store is development-only');
    this.root = path.resolve(root);
  }
  private async filename(name: string) {
    archiveName(name);
    const stat = await fs.lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid backup directory');
    const filename = path.join(this.root, name);
    const existing = await fs.lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Invalid backup file');
    return filename;
  }
  async put(name: string, bytes: Buffer) { encrypted(bytes); await fs.writeFile(await this.filename(name), bytes, { flag: 'wx', mode: 0o600 }); }
  async get(name: string) {
    const handle = await fs.open(await this.filename(name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if ((await handle.stat()).size > MAX_ARCHIVE_BYTES + 32) throw new Error('Backup exceeds size limit');
      return encrypted(await handle.readFile());
    } finally { await handle.close(); }
  }
  async list() {
    const items: BackupObject[] = [];
    for (const name of await fs.readdir(this.root)) {
      try { archiveName(name); } catch { continue; }
      items.push({ name, bytes: (await fs.stat(await this.filename(name))).size });
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }
  async delete(name: string) { await fs.unlink(await this.filename(name)); }
}
type Client = { send(command: any, options?: { abortSignal: AbortSignal }): Promise<any> };
export class S3BackupStore implements BackupStore {
  constructor(private options: { bucket: string; prefix: string; client: Client }) {
    if (!options.bucket || !['production/', 'staging/', 'development/'].includes(options.prefix)) throw new Error('Invalid backup store');
  }
  private key(name: string) { return this.options.prefix + archiveName(name); }
  private send(command: Parameters<Client['send']>[0]) { return this.options.client.send(command, { abortSignal: AbortSignal.timeout(30_000) }); }
  async put(name: string, bytes: Buffer) {
    await this.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: this.key(name), Body: encrypted(bytes), ContentType: 'application/octet-stream', IfNoneMatch: '*' }));
  }
  async get(name: string) {
    const result = await this.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: this.key(name) }));
    if (!result.Body || result.ContentLength > MAX_ARCHIVE_BYTES + 32) throw new Error('Invalid backup response');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length; if (size > MAX_ARCHIVE_BYTES + 32) { result.Body.destroy?.(); throw new Error('Backup exceeds size limit'); }
      chunks.push(Buffer.from(chunk));
    }
    return encrypted(Buffer.concat(chunks));
  }
  async list() {
    const items: BackupObject[] = []; let token: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const result = await this.send(new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: this.options.prefix, ContinuationToken: token, MaxKeys: 1000 }));
      for (const entry of result.Contents ?? []) {
        if (typeof entry.Key !== 'string' || !entry.Key.startsWith(this.options.prefix)) continue;
        const name = entry.Key.slice(this.options.prefix.length);
        try { archiveName(name); } catch { continue; }
        if (!Number.isSafeInteger(entry.Size) || entry.Size < 0) throw new Error('Invalid backup listing');
        items.push({ name, bytes: entry.Size });
      }
      if (!result.IsTruncated) return items;
      token = result.NextContinuationToken;
      if (!token || seen.has(token)) throw new Error('Incomplete backup listing');
      seen.add(token);
    }
    throw new Error('Backup listing exceeds limit');
  }
  async delete(name: string) { await this.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.key(name) })); }
}
export function configuredStore(env: Record<string, string | undefined>, mode: EnvMode): BackupStore {
  const endpoint = env.OMEGA_BACKUP_S3_ENDPOINT;
  const bucket = env.OMEGA_BACKUP_S3_BUCKET;
  const accessKeyId = env.OMEGA_BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.OMEGA_BACKUP_S3_SECRET_ACCESS_KEY;
  const region = env.OMEGA_BACKUP_S3_REGION;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !region) throw new Error('Backup storage not configured');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid backup endpoint');
  return new S3BackupStore({ bucket, prefix: `${mode}/`, client: new S3Client({ endpoint, region, forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 }) });
}
