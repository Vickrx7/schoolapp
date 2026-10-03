/**
 * Name-based UUIDs (version 5, RFC 9562) in plain TypeScript, so the package stays pure and
 * runs anywhere: content packs get the same ids on every build and every install.
 */

/** Namespace of Lynx content-pack ids. Never change it: ids would change with it. */
export const LYNX_CONTENT_NAMESPACE = '27873b78-e429-4600-bbba-25cc5d75ab11';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return bytes;
}

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

/** SHA-1 of a byte array (20 bytes). */
export function sha1(message: readonly number[]): number[] {
  const bytes = [...message, 0x80];
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLength = message.length * 8;
  const high = Math.floor(bitLength / 0x100000000);
  for (const word of [high, bitLength >>> 0]) {
    bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999];
      else if (i < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1];
      else if (i < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
      else [f, k] = [b ^ c ^ d, 0xca62c1d6];
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30), a, temp];
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].flatMap((h) => [
    (h >>> 24) & 0xff,
    (h >>> 16) & 0xff,
    (h >>> 8) & 0xff,
    h & 0xff,
  ]);
}

/** The version 5 UUID of `name` in `namespace`. */
export function uuidv5(name: string, namespace: string = LYNX_CONTENT_NAMESPACE): string {
  if (!UUID_PATTERN.test(namespace)) throw new Error(`invalid namespace UUID: ${namespace}`);
  const ns = namespace
    .replace(/-/g, '')
    .match(/../g)!
    .map((h) => parseInt(h, 16));
  const hash = sha1([...ns, ...utf8(name)]).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
