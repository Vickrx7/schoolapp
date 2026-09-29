import { describe, expect, it } from 'vitest';
import {
  ACCESS_CODE_ALPHABET,
  ACCESS_CODE_LENGTH,
  formatAccessCode,
  generateAccessCode,
  normalizeAccessCode,
} from './access-code';

const bytes = (values: number[]) => () => Uint8Array.from(values);

describe('generateAccessCode', () => {
  it('makes 10 characters from the Crockford alphabet', () => {
    expect(ACCESS_CODE_ALPHABET).toHaveLength(32);
    expect(ACCESS_CODE_ALPHABET).not.toMatch(/[ILOU]/);
    for (let i = 0; i < 50; i++) {
      const random = (n: number) =>
        Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
      const code = generateAccessCode(random);
      expect(code).toHaveLength(ACCESS_CODE_LENGTH);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    }
  });

  it('maps each byte to a letter with its low 5 bits', () => {
    expect(generateAccessCode(bytes([0, 1, 31, 32, 255, 10, 17, 18, 29, 224]))).toBe('01Z0ZAHJX0');
    expect(() => generateAccessCode(bytes([1, 2, 3]))).toThrow(RangeError);
  });
});

describe('formatAccessCode', () => {
  it('shows the code as XXXXX-XXXXX', () => {
    expect(formatAccessCode('7KQ4M9TDXA')).toBe('7KQ4M-9TDXA');
    expect(formatAccessCode('7kq4m 9tdxa')).toBe('7KQ4M-9TDXA');
    expect(() => formatAccessCode('7KQ4M')).toThrow(RangeError);
  });
});

describe('normalizeAccessCode', () => {
  it('accepts lowercase, spaces, hyphens and look-alike letters', () => {
    expect(normalizeAccessCode('7KQ4M-9TDXA')).toBe('7KQ4M9TDXA');
    expect(normalizeAccessCode(' 7kq4m 9tdxa ')).toBe('7KQ4M9TDXA');
    expect(normalizeAccessCode('7KQ4M–9TDXA')).toBe('7KQ4M9TDXA'); // en dash from autocorrect
    expect(normalizeAccessCode('oO1il-LIo0o')).toBe('0011111000');
  });

  it('refuses U, other characters and wrong lengths', () => {
    expect(normalizeAccessCode('7KQ4M-9TDXU')).toBeNull();
    expect(normalizeAccessCode('7KQ4M-9TDX!')).toBeNull();
    expect(normalizeAccessCode('7KQ4M-9TDXÉ')).toBeNull();
    expect(normalizeAccessCode('7KQ4M-9TDX')).toBeNull();
    expect(normalizeAccessCode('7KQ4M-9TDXAB')).toBeNull();
    expect(normalizeAccessCode('')).toBeNull();
  });
});
