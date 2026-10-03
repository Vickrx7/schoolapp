/**
 * The client address for per-network throttling (DECISIONS D-051). Behind reverse proxies that
 * append to X-Forwarded-For, the right-most entries were added by proxies we trust and anything
 * to their left may be forged by the client: the address is the entry `hops` places from the
 * right. A missing header, too few entries, `hops = 0` or a value that is not an address give
 * 'unknown', and all such requests share one bucket. Not server-only so it can be unit tested.
 */

const ADDRESS = /^[0-9a-f.:]{2,45}$/;

/** Removes IPv6 brackets, a port (on IPv4 or bracketed IPv6) and an IPv6 zone. */
function cleanAddress(entry: string): string | null {
  let value = entry.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value))
    value = value.slice(0, value.lastIndexOf(':'));
  value = value.replace(/%.*$/, '');
  return ADDRESS.test(value) ? value : null;
}

export function clientIp(
  headers: { get(name: string): string | null },
  headerName: string,
  hops: number,
): string {
  if (!Number.isInteger(hops) || hops < 1) return 'unknown';
  const raw = headers.get(headerName);
  if (!raw) return 'unknown';
  const entries = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const entry = entries[entries.length - hops];
  if (entry === undefined) return 'unknown';
  return cleanAddress(entry) ?? 'unknown';
}
