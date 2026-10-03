/**
 * Supabase Auth's own per-address limits on code requests and checks (DECISIONS D-121). Auth
 * applies them only when it can tell who is asking: on the board-hosted install it reads the
 * client's address from the header `GOTRUE_RATE_LIMIT_HEADER` names (deploy/docker
 * compose.supabase.yml), which the web server sets on its sign-in calls to the address it derived
 * itself (CLIENT_IP_HEADER, TRUSTED_PROXY_HOPS). Auth is never reachable from outside, so nobody
 * else can set it. An unknown address sends nothing: Auth then skips its limits rather than put
 * everyone in one bucket, and the app's own throttle (`sign_in_attempt`) still applies. Not
 * server-only so it can be unit tested.
 */

export const AUTH_CLIENT_IP_HEADER = 'X-Lynx-Client-Ip';

export function authRateLimitHeaders(clientIp: string): Record<string, string> {
  return clientIp === 'unknown' ? {} : { [AUTH_CLIENT_IP_HEADER]: clientIp };
}
