import { describe, expect, it } from 'vitest';
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  formatJoinCode,
  isClassLinkToken,
  normalizeJoinCode,
} from './code';

describe('join code alphabet', () => {
  it('has 22 distinct characters and no look-alikes', () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(22);
    expect(new Set(JOIN_CODE_ALPHABET).size).toBe(22);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[0OQ1IL2Z5S6G8B]/);
    expect(JOIN_CODE_LENGTH).toBe(6);
  });
});

describe('normalizeJoinCode (W1)', () => {
  it('accepts lowercase and grouped codes', () => {
    expect(normalizeJoinCode('K7M4R9')).toBe('K7M4R9');
    expect(normalizeJoinCode('k7m4r9')).toBe('K7M4R9');
    expect(normalizeJoinCode('K7M 4R9')).toBe('K7M4R9');
    expect(normalizeJoinCode(' k7m-4r9 ')).toBe('K7M4R9');
    expect(normalizeJoinCode('K7M.4R9')).toBe('K7M4R9');
    expect(normalizeJoinCode('K7M – 4R9')).toBe('K7M4R9'); // en dash from autocorrect
    expect(normalizeJoinCode('K7M\u00a04R9')).toBe('K7M4R9'); // copied from the projector
    expect(normalizeJoinCode('ｋ７ｍ４ｒ９')).toBe('K7M4R9'); // full-width input
  });

  it('accepts every character of the alphabet', () => {
    for (let i = 0; i < JOIN_CODE_ALPHABET.length; i += JOIN_CODE_LENGTH) {
      const code = JOIN_CODE_ALPHABET.slice(i, i + JOIN_CODE_LENGTH).padEnd(JOIN_CODE_LENGTH, 'A');
      expect(normalizeJoinCode(code.toLowerCase())).toBe(code);
    }
  });

  it.each(['O', '0', 'Q', 'S', '5', 'I', '1', 'L', 'Z', '2', 'B', '8', 'G', '6'])(
    'refuses the look-alike %s',
    (ch) => {
      expect(normalizeJoinCode(`K7M4R${ch}`)).toBeNull();
      expect(normalizeJoinCode(`K7M4R${ch}`.toLowerCase())).toBeNull();
    },
  );

  it('refuses other characters and wrong lengths', () => {
    expect(normalizeJoinCode('K7M4R!')).toBeNull();
    expect(normalizeJoinCode('K7M4RÉ')).toBeNull();
    expect(normalizeJoinCode('K7M4R_')).toBeNull();
    expect(normalizeJoinCode('K7M4R')).toBeNull();
    expect(normalizeJoinCode('K7M4R9A')).toBeNull();
    expect(normalizeJoinCode('')).toBeNull();
    expect(normalizeJoinCode('   ')).toBeNull();
    expect(normalizeJoinCode(`K7M4R9${' '.repeat(80)}`)).toBeNull();
    expect(normalizeJoinCode(42 as unknown as string)).toBeNull();
  });
});

describe('formatJoinCode', () => {
  it('shows two groups of three that never wrap', () => {
    expect(formatJoinCode('K7M4R9')).toBe('K7M\u00a04R9');
    expect(formatJoinCode('k7m 4r9')).toBe('K7M\u00a04R9');
    expect(() => formatJoinCode('K7M4R')).toThrow(RangeError);
  });
});

describe('isClassLinkToken', () => {
  it('accepts 43 base64url characters only', () => {
    const token = 'aB3_-'.repeat(8) + 'xyz';
    expect(token).toHaveLength(43);
    expect(isClassLinkToken(token)).toBe(true);
    expect(isClassLinkToken(token.slice(1))).toBe(false);
    expect(isClassLinkToken(`${token.slice(1)}=`)).toBe(false);
    expect(isClassLinkToken(`${token.slice(1)}+`)).toBe(false);
    expect(isClassLinkToken(null)).toBe(false);
  });
});
