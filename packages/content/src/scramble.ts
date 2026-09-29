/**
 * Deterministic scrambling (DECISIONS D-062). Ordering items and matching right columns are
 * stored in display order, which must never give the answer away. The order depends only on
 * the question id and the number of items, so saving again gives the same sheet, and the
 * editor can recover the author's order.
 */

/** FNV-1a, 32 bits. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small, well-mixed generator. */
function generator(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isIdentity = (perm: readonly number[]) => perm.every((v, i) => v === i);

/**
 * A permutation of `0..n-1` (display position → original index), never the identity when
 * `n ≥ 2`.
 */
export function permutationFor(seed: string, n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  const next = generator(hash(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  if (n >= 2 && isIdentity(perm)) perm.push(perm.shift()!);
  return perm;
}

/** Items in display order. */
export function scrambleBySeed<T>(items: readonly T[], seed: string): T[] {
  return permutationFor(seed, items.length).map((i) => items[i]!);
}

/** The original order back from the display order and the permutation that produced it. */
export function unscramble<T>(display: readonly T[], perm: readonly number[]): T[] {
  const original: T[] = new Array<T>(display.length);
  perm.forEach((from, to) => {
    original[from] = display[to]!;
  });
  return original;
}

/**
 * The right column of a matching question: the paired items (first `pairCount` indexes, in
 * the order of the left column) then the extra ones. Besides never being the identity, the
 * paired items never keep the left column's order, so row n never simply matches row n.
 */
export function matchingPermutation(seed: string, n: number, pairCount: number): number[] {
  const perm = permutationFor(seed, n);
  if (pairCount < 2) return perm;
  const positions = perm.flatMap((from, to) => (from < pairCount ? [to] : []));
  const paired = positions.map((p) => perm[p]!);
  if (isIdentity(paired)) {
    const [a, b] = positions as [number, number];
    [perm[a], perm[b]] = [perm[b]!, perm[a]!];
  }
  return perm;
}

export const orderingSeed = (questionId: string) => questionId;
export const matchingSeed = (questionId: string) => `${questionId}:right`;
