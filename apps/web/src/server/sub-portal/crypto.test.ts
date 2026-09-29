import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codeMac, codeMacs, deviceKey, ipKey, subCodeRing } from './crypto';

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const k3 = randomBytes(32);
const spec = (...keys: [number, Buffer][]) =>
  keys.map(([v, k]) => `${v}:${k.toString('base64')}`).join(',');

describe('substitute code hashing', () => {
  it('reads the key ring: empty is off, two keys at most', () => {
    expect(subCodeRing('')).toBeNull();
    expect(subCodeRing(spec([1, k1], [2, k2]))?.current).toBe(2);
    expect(() => subCodeRing(spec([1, k1], [2, k2], [3, k3]))).toThrow(/at most two keys/);
    expect(() => subCodeRing('1:short')).toThrow(/SUB_CODE_HMAC_KEYS/);
  });

  it('is a keyed MAC: stable per key, different across keys', () => {
    const ring1 = subCodeRing(spec([1, k1]))!;
    const ring2 = subCodeRing(spec([1, k2]))!;
    const mac = codeMac('7KQ4M9TDXA', ring1);
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
    expect(codeMac('7KQ4M9TDXA', ring1)).toBe(mac);
    expect(codeMac('7KQ4M9TDXA', ring2)).not.toBe(mac);
    expect(codeMac('7KQ4M9TDXB', ring1)).not.toBe(mac);
    expect(mac).toBe(createHmac('sha256', k1).update('sub-code:v1:7KQ4M9TDXA').digest('hex'));
    // Without the key, the code's plain hash gives nothing away.
    expect(mac).not.toBe(createHash('sha256').update('7KQ4M9TDXA').digest('hex'));
  });

  it('looks a typed code up with one MAC per key, the current key first', () => {
    const old = subCodeRing(spec([1, k1]))!;
    const rotated = subCodeRing(spec([1, k1], [2, k2]))!;
    const macs = codeMacs('7KQ4M9TDXA', rotated);
    expect(macs).toHaveLength(2);
    expect(macs[0]).toBe(codeMac('7KQ4M9TDXA', rotated));
    // A code issued before the rotation is still found.
    expect(macs).toContain(codeMac('7KQ4M9TDXA', old));
    expect(codeMacs('7KQ4M9TDXA', old)).toEqual([codeMac('7KQ4M9TDXA', old)]);
  });

  it('turns the device cookie and the address into keys that do not contain them', () => {
    const ring = subCodeRing(spec([1, k1]))!;
    const cookie = randomBytes(32).toString('base64url');
    const device = deviceKey(cookie, ring);
    const ip = ipKey('203.0.113.7', ring);
    for (const key of [device, ip]) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(device).not.toContain(Buffer.from(cookie, 'base64url').toString('hex').slice(0, 16));
    expect(ip).not.toContain('203');
    expect(deviceKey(cookie, ring)).toBe(device);
    // Different purposes never collide, even for the same input.
    expect(deviceKey('203.0.113.7', ring)).not.toBe(ip);
    expect(codeMac('203.0.113.7', ring)).not.toBe(ip);
  });
});
