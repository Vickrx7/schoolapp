import { describe, expect, it } from 'vitest';
import { AUTH_CLIENT_IP_HEADER, authRateLimitHeaders } from './auth-rate-limit';

describe('authRateLimitHeaders (D-121)', () => {
  it('tells Auth the client’s address, or nothing when it is unknown', () => {
    expect(authRateLimitHeaders('203.0.113.7')).toEqual({ 'X-Lynx-Client-Ip': '203.0.113.7' });
    expect(authRateLimitHeaders('2001:db8::1')).toEqual({ [AUTH_CLIENT_IP_HEADER]: '2001:db8::1' });
    expect(authRateLimitHeaders('unknown')).toEqual({});
  });
});
