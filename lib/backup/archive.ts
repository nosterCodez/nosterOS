import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('OBK1');
const KEY_ERROR = 'Configure a separate 32-byte base64 OMEGA_BACKUP_KEY';

export function backupKey(env: Record<string, string | undefined> = process.env): Buffer {
  const value = env.OMEGA_BACKUP_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error(KEY_ERROR);
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error(KEY_ERROR);
  for (const [name, other] of Object.entries(env)) {
    if (name === 'OMEGA_BACKUP_KEY' || !other) continue;
    if (other === value || other.toLowerCase() === key.toString('hex')) throw new Error(KEY_ERROR);
  }
  return key;
}

/** OBK1 | random IV (12 bytes) | AES-256-GCM ciphertext | tag (16 bytes). */
export function encryptArchive(archive: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error(KEY_ERROR);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  return Buffer.concat([MAGIC, iv, ciphertext, cipher.getAuthTag()]);
}

export function decryptArchive(encrypted: Buffer, key: Buffer): Buffer {
  try {
    if (key.length !== 32 || encrypted.length < 32 || !encrypted.subarray(0, 4).equals(MAGIC)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(4, 16));
    decipher.setAuthTag(encrypted.subarray(-16));
    return Buffer.concat([decipher.update(encrypted.subarray(16, -16)), decipher.final()]);
  } catch { throw new Error('Invalid encrypted backup'); }
}
