import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classPortalKey, deviceKey, networkKey } from './crypto';

const k1 = randomBytes(32);
const k2 = randomBytes(32);

describe('class portal keys (D-083, D-084)', () => {
  it('reads CLASS_PORTAL_HMAC_KEY: empty is off, 32 bytes of base64 otherwise', () => {
    expect(classPortalKey('')).toBeNull();
    expect(classPortalKey('   ')).toBeNull();
    expect(classPortalKey(k1.toString('base64'))?.equals(k1)).toBe(true);
    // The local development key of .env.example.
    expect(classPortalKey('ZGV2LW9ubHktY2xhc3MtcG9ydGFsLWtleS1kby1ub3Q=')).toHaveLength(32);
    expect(() => classPortalKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => classPortalKey('1:abc')).toThrow(/base64/);
  });

  it('gives the same cookie the same device key, and nothing without the key', () => {
    const cookie = randomBytes(32).toString('base64url');
    const key = deviceKey(cookie, k1);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceKey(cookie, k1)).toBe(key);
    expect(deviceKey(`${cookie}x`, k1)).not.toBe(key);
    expect(deviceKey(cookie, k2)).not.toBe(key);
    expect(key).toBe(createHmac('sha256', k1).update(`class-device:${cookie}`).digest('hex'));
    expect(key).not.toBe(createHash('sha256').update(cookie).digest('hex'));
  });

  it('keys networks apart from devices with their own prefix', () => {
    const net = networkKey('203.0.113.7', k1);
    expect(net).toMatch(/^[0-9a-f]{64}$/);
    expect(networkKey('203.0.113.7', k1)).toBe(net);
    expect(networkKey('2001:db8:0:1::/64', k1)).not.toBe(net);
    expect(net).toBe(createHmac('sha256', k1).update('class-net:203.0.113.7').digest('hex'));
    // The same text as a device cookie and as a network never gives the same key.
    expect(deviceKey('unknown', k1)).not.toBe(networkKey('unknown', k1));
  });
});
