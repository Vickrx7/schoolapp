import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const headers = (value: string | null, name = 'x-forwarded-for') => ({
  get: (h: string) => (h === name ? value : null),
});

describe('client address for throttling', () => {
  it('takes the entry added by the last trusted proxy', () => {
    expect(clientIp(headers('198.51.100.9'), 'x-forwarded-for', 1)).toBe('198.51.100.9');
    expect(clientIp(headers('203.0.113.7, 10.0.0.2'), 'x-forwarded-for', 1)).toBe('10.0.0.2');
    expect(clientIp(headers('203.0.113.7, 10.0.0.2'), 'x-forwarded-for', 2)).toBe('203.0.113.7');
  });

  it('ignores what the client wrote to the left of the trusted entries', () => {
    // The client sent « 1.2.3.4 »; one proxy appended the real address.
    expect(clientIp(headers('1.2.3.4, 203.0.113.7'), 'x-forwarded-for', 1)).toBe('203.0.113.7');
    expect(clientIp(headers('1.2.3.4,  , 203.0.113.7'), 'x-forwarded-for', 1)).toBe('203.0.113.7');
  });

  it('shares one bucket when the address is missing or cannot be trusted', () => {
    expect(clientIp(headers(null), 'x-forwarded-for', 1)).toBe('unknown');
    expect(clientIp(headers(''), 'x-forwarded-for', 1)).toBe('unknown');
    expect(clientIp(headers('203.0.113.7'), 'x-forwarded-for', 2)).toBe('unknown');
    expect(clientIp(headers('203.0.113.7'), 'x-forwarded-for', 0)).toBe('unknown');
    expect(clientIp(headers('<script>'), 'x-forwarded-for', 1)).toBe('unknown');
  });

  it('reads the configured header and normalizes ports and IPv6 forms', () => {
    expect(clientIp(headers('198.51.100.9', 'x-real-ip'), 'x-real-ip', 1)).toBe('198.51.100.9');
    expect(clientIp(headers('198.51.100.9:52100'), 'x-forwarded-for', 1)).toBe('198.51.100.9');
    expect(clientIp(headers('[2001:DB8::1]:443'), 'x-forwarded-for', 1)).toBe('2001:db8::1');
    expect(clientIp(headers('fe80::1%eth0'), 'x-forwarded-for', 1)).toBe('fe80::1');
    expect(clientIp(headers('::1'), 'x-forwarded-for', 1)).toBe('::1');
  });
});
