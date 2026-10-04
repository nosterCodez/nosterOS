import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDb } from '@/lib/db';
import { resolveCred, saveCredential, revokeCredential, connectionMetadata, vaultReady } from '@/lib/creds';

const databases: ReturnType<typeof openDb>[] = [];
function workspace(id = 'A'.repeat(32)) {
  const db = openDb(':memory:'); databases.push(db);
  return { workspace: { id }, db };
}
function master() { vi.stubEnv('NOSTEROS_MASTER_KEY', randomBytes(32).toString('hex')); }
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); });
describe('workspace credential vault', () => {
  it('stores only ciphertext; resolves fresh and revokes without environment fallback', () => {
    master(); const a = workspace();
    vi.stubEnv('OPENAI_API_KEY', 'host-must-never-resolve');
    expect(resolveCred(a, 'OPENAI_API_KEY')).toBeUndefined();
    saveCredential(a, 'OPENAI_API_KEY', 'private-client-key');
    expect(resolveCred(a, 'OPENAI_API_KEY')).toBe('private-client-key');
    expect(JSON.stringify(a.db.connectionRecords.get('OPENAI_API_KEY'))).not.toContain('private-client-key');
    expect(JSON.stringify(connectionMetadata(a))).not.toContain('private-client-key');
    saveCredential(a, 'OPENAI_API_KEY', 'replacement-key');
    expect(resolveCred(a, 'OPENAI_API_KEY')).toBe('replacement-key');
    revokeCredential(a, 'OPENAI_API_KEY');
    expect(resolveCred(a, 'OPENAI_API_KEY')).toBeUndefined();
    expect(connectionMetadata(a).find(s => s.name === 'OPENAI_API_KEY')?.status).toBe('revoked');
  });
  it('uses independent data keys and random nonces for every encryption', () => {
    master(); const a = workspace(), b = workspace('B'.repeat(32));
    saveCredential(a, 'OPENAI_API_KEY', 'same-secret');
    const first = a.db.connectionRecords.get('OPENAI_API_KEY');
    saveCredential(a, 'OPENAI_API_KEY', 'same-secret');
    saveCredential(b, 'OPENAI_API_KEY', 'same-secret');
    expect(first?.envelope).not.toEqual(a.db.connectionRecords.get('OPENAI_API_KEY')?.envelope);
    expect(a.db.connectionRecords.key()).not.toEqual(b.db.connectionRecords.key());
    expect(resolveCred(a, 'OPENAI_API_KEY')).toBe('same-secret');
    expect(resolveCred(b, 'OPENAI_API_KEY')).toBe('same-secret');
  });
  it('fails closed for missing, invalid, or changed master keys', () => {
    const a = workspace(); vi.stubEnv('NOSTEROS_MASTER_KEY', '');
    expect(vaultReady(a)).toBe(false);
    expect(() => saveCredential(a, 'OPENAI_API_KEY', 'secret')).toThrow('Connection vault unavailable');
    vi.stubEnv('NOSTEROS_MASTER_KEY', 'a'.repeat(63));
    expect(() => saveCredential(a, 'OPENAI_API_KEY', 'secret')).toThrow();
    master(); saveCredential(a, 'OPENAI_API_KEY', 'secret'); master();
    expect(vaultReady(a)).toBe(false);
    expect(() => resolveCred(a, 'OPENAI_API_KEY')).toThrow('Connection vault unavailable');
    expect(() => saveCredential(a, 'OPENAI_API_KEY', 'replacement')).toThrow();
  });
  it('rejects copied workspace/slot/key envelopes and corrupted ciphertext', () => {
    master(); const a = workspace(), b = workspace('B'.repeat(32));
    saveCredential(a, 'OPENAI_API_KEY', 'do-not-leak');
    saveCredential(b, 'OPENAI_API_KEY', 'other');
    const row = a.db.connectionRecords.get('OPENAI_API_KEY')!;
    b.db.connectionRecords.put(row);
    expect(() => resolveCred(b, 'OPENAI_API_KEY')).toThrow();
    a.db.connectionRecords.put({ ...row, name: 'ANTHROPIC_API_KEY' });
    expect(() => resolveCred(a, 'ANTHROPIC_API_KEY')).toThrow();
    a.db.connectionRecords.put({ ...row, envelope: { ...row.envelope, ciphertext: randomBytes(11).toString('base64') } });
    expect(() => resolveCred(a, 'OPENAI_API_KEY')).toThrow();
    const fake = { ...a, workspace: b.workspace };
    expect(() => resolveCred(fake, 'OPENAI_API_KEY')).toThrow();
  });
  it('rejects platform secrets and malformed values without echoing them', () => {
    master(); const a = workspace();
    for (const name of ['BETTER_AUTH_SECRET', 'NOSTEROS_MASTER_KEY', '__proto__']) {
      expect(() => saveCredential(a, name, 'private')).toThrow('Unsupported connection field');
    }
    for (const value of ['', ' ', 'secret\nINJECTED=1', 'a'.repeat(4097)]) {
      expect(() => saveCredential(a, 'OPENAI_API_KEY', value)).toThrow('Invalid connection value');
    }
    expect(() => saveCredential({ ...a, workspace: { id: '../escape' } }, 'OPENAI_API_KEY', 'secret')).toThrow();
  });
});
