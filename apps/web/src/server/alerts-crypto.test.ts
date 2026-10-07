import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptAlert, encryptAlert, parseKeyRing } from './alerts-crypto';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');

describe('alert encryption', () => {
  it('round-trips French text and never stores it in the clear', () => {
    const ring = parseKeyRing(`1:${k1}`)!;
    const text = 'Allergie sévère aux arachides, ÉpiPen dans le sac à dos';
    const { ciphertext, keyVersion } = encryptAlert(text, 'student-1', ring);
    expect(keyVersion).toBe(1);
    expect(ciphertext).not.toContain('arachides');
    expect(decryptAlert(ciphertext, 'student-1', ring)).toBe(text);
  });

  it('refuses to decrypt a ciphertext moved to another student', () => {
    const ring = parseKeyRing(`1:${k1}`)!;
    const { ciphertext } = encryptAlert('Asthme', 'student-1', ring);
    expect(() => decryptAlert(ciphertext, 'student-2', ring)).toThrow();
  });

  it('encrypts with the newest key and still reads older versions', () => {
    const old = parseKeyRing(`1:${k1}`)!;
    const rotated = parseKeyRing(`1:${k1},2:${k2}`)!;
    const legacy = encryptAlert('Épilepsie', 's', old).ciphertext;
    const fresh = encryptAlert('Épilepsie', 's', rotated);
    expect(fresh.keyVersion).toBe(2);
    expect(decryptAlert(legacy, 's', rotated)).toBe('Épilepsie');
  });

  it('rejects malformed key configuration', () => {
    expect(parseKeyRing('')).toBeNull();
    expect(() => parseKeyRing('1:tooShort')).toThrow(/32 bytes/);
    expect(() => parseKeyRing('abc')).toThrow();
  });
});
