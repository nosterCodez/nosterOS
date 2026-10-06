import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { backupKey, encryptArchive, decryptArchive } from '@/lib/backup/archive';

test('OBK1 archive round-trips bytes with a fresh 12-byte IV and 16-byte tag', () => {
  const key = randomBytes(32), input = Buffer.from('fixture archive bytes');
  const encrypted = encryptArchive(input, key);
  expect(encrypted.subarray(0, 4).toString()).toBe('OBK1');
  expect(encrypted.length).toBe(4 + 12 + input.length + 16);
  expect(decryptArchive(encrypted, key)).toEqual(input);
  expect(encryptArchive(input, key)).not.toEqual(encrypted);
  expect(encrypted.includes(input)).toBe(false);
});
test('wrong key, tampered magic/IV/ciphertext/tag and truncated archives fail closed', () => {
  const key = randomBytes(32), encrypted = encryptArchive(Buffer.from('fixture archive'), key);
  expect(() => decryptArchive(encrypted, randomBytes(32))).toThrow('Invalid encrypted backup');
  for (const index of [0, 4, 16, encrypted.length - 1]) {
    const corrupt = Buffer.from(encrypted); corrupt[index] ^= 1;
    expect(() => decryptArchive(corrupt, key)).toThrow('Invalid encrypted backup');
  }
  for (const size of [0, 4, 16, 31, encrypted.length - 1]) {
    expect(() => decryptArchive(encrypted.subarray(0, size), key)).toThrow();
  }
});
test('missing, noncanonical or wrong-length backup keys refuse without exposing values', () => {
  for (const raw of [undefined, '', 'fixture-secret', randomBytes(31).toString('base64'), randomBytes(33).toString('base64'), randomBytes(32).toString('hex')]) {
    expect(() => backupKey({ OMEGA_BACKUP_KEY: raw })).toThrow('Configure a separate 32-byte base64 OMEGA_BACKUP_KEY');
  }
  const key = randomBytes(32);
  expect(backupKey({ OMEGA_BACKUP_KEY: key.toString('base64') })).toEqual(key);
  expect(() => encryptArchive(Buffer.from('fixture'), Buffer.alloc(16))).toThrow();
  expect(() => decryptArchive(Buffer.alloc(32), Buffer.alloc(16))).toThrow();
});
test('backup key cannot reuse another configured secret, including decoded hex representation', () => {
  const key = randomBytes(32), encoded = key.toString('base64');
  for (const name of ['BETTER_AUTH_SECRET', 'NOSTEROS_MASTER_KEY', 'NOSTEROS_INTERNAL_SECRET', 'OMEGA_ETSY_CLIENT_SECRET']) {
    expect(() => backupKey({ OMEGA_BACKUP_KEY: encoded, [name]: encoded })).toThrow('separate');
    expect(() => backupKey({ OMEGA_BACKUP_KEY: encoded, [name]: key.toString('hex') })).toThrow('separate');
  }
});
