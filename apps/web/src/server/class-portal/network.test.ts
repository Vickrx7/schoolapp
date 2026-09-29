import { describe, expect, it } from 'vitest';
import { networkPrefix } from './network';

describe('networkPrefix (W2)', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(networkPrefix('203.0.113.7')).toBe('203.0.113.7');
    expect(networkPrefix('10.0.0.1')).toBe('10.0.0.1');
    expect(networkPrefix('010.000.000.001')).toBe('10.0.0.1');
  });

  it('groups an IPv6 address by its /64', () => {
    expect(networkPrefix('2001:db8:0:1:1a2b:3c4d:5e6f:7a8b')).toBe('2001:db8:0:1::/64');
    expect(networkPrefix('2001:db8:0:1::9')).toBe('2001:db8:0:1::/64');
    expect(networkPrefix('2001:0DB8:0000:0001::1')).toBe('2001:db8:0:1::/64');
    expect(networkPrefix('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(networkPrefix('::1')).toBe('0:0:0:0::/64');
    expect(networkPrefix('fe80::1')).toBe('fe80:0:0:0::/64');
  });

  it('puts two devices of one /64 in the same bucket, and another /64 apart', () => {
    const a = networkPrefix('2001:db8:aa:bb:1111:2222:3333:4444');
    const b = networkPrefix('2001:db8:aa:bb::abcd');
    const c = networkPrefix('2001:db8:aa:bc::abcd');
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('reads IPv4 written in IPv6', () => {
    expect(networkPrefix('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(networkPrefix('::ffff:c000:201')).toBe('192.0.2.1');
    // NAT64: the /64 of the translator, like any other IPv6 address.
    expect(networkPrefix('64:ff9b::198.51.100.7')).toBe('64:ff9b:0:0::/64');
  });

  it("keeps 'unknown' and turns anything else into 'unknown'", () => {
    expect(networkPrefix('unknown')).toBe('unknown');
    expect(networkPrefix('')).toBe('unknown');
    expect(networkPrefix('1.2.3')).toBe('unknown');
    expect(networkPrefix('1.2.3.256')).toBe('unknown');
    expect(networkPrefix('1.2.3.4.5')).toBe('unknown');
    expect(networkPrefix('2001:db8::1::2')).toBe('unknown');
    expect(networkPrefix('2001:db8:1:2:3:4:5:6:7')).toBe('unknown');
    expect(networkPrefix('2001:db8:1:2:3:4:5')).toBe('unknown');
    expect(networkPrefix('1:2:3:4::5:6:7:8')).toBe('unknown');
    expect(networkPrefix('2001:db8::12345')).toBe('unknown');
    expect(networkPrefix('::ffff:1.2.3.999')).toBe('unknown');
    expect(networkPrefix(':::')).toBe('unknown');
    expect(networkPrefix(undefined as unknown as string)).toBe('unknown');
  });
});
