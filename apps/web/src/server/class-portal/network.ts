/**
 * The network bucket for join throttling (DECISIONS D-084). The per-network count
 * of failed typed codes is keyed by an HMAC of this prefix (`crypto.ts#networkKey`), never by a
 * raw address:
 *
 * - an IPv4 address is its own bucket (many boards send every school through a few addresses,
 *   which is why the network limit is loose);
 * - an IPv6 address is grouped by its /64, because one home or classroom network usually holds
 *   a whole /64 and a device can pick a new address inside it at will;
 * - an IPv4 address written in IPv6 (`::ffff:192.0.2.1`) is the IPv4 address;
 * - 'unknown' (from `clientIp()`) stays 'unknown', and so does anything that is not an address:
 *   all such requests share one bucket.
 *
 * The input is `server/sub-portal/client-ip.ts#clientIp()`'s output (lowercase, no port, zone or
 * brackets). Pure so it is unit-tested.
 */

/** The octets of a dotted-quad IPv4 address, or null. */
function ipv4Octets(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => Number.isInteger(o) && o <= 255) ? octets : null;
}

/** The 8 groups of an IPv6 address (with `::` expanded and a trailing IPv4 part), or null. */
function ipv6Groups(value: string): number[] | null {
  let text = value;
  // An embedded IPv4 address (`::ffff:192.0.2.1`, `64:ff9b::198.51.100.7`) is the last 2 groups.
  const embedded = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded) {
    const octets = ipv4Octets(embedded[2]!);
    if (!octets) return null;
    const [a, b, c, d] = octets as [number, number, number, number];
    text = `${embedded[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (half: string): number[] | null => {
    if (half === '') return [];
    const groups = half.split(':');
    return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))
      ? groups.map((g) => parseInt(g, 16))
      : null;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  // `::` stands for at least one group of zeros.
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * The throttling bucket of a client address: « 203.0.113.7 », « 2001:db8:0:1::/64 » or
 * 'unknown'.
 */
export function networkPrefix(ip: string): string {
  const value = typeof ip === 'string' ? ip.trim().toLowerCase() : '';
  if (!value || value === 'unknown' || value.length > 45) return 'unknown';

  const octets = ipv4Octets(value);
  if (octets) return octets.join('.');

  const groups = ipv6Groups(value);
  if (!groups) return 'unknown';
  // An IPv4-mapped address (::ffff:a.b.c.d) is the IPv4 client itself.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6]!, groups[7]!];
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}
