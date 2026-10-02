import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_TERMS_VERSION, TERMS_VERSION_PATTERN, isTermsVersion, termsState } from './legal';

describe('the pilot terms (D-109, D-110)', () => {
  it('has a current version the database accepts', () => {
    expect(CURRENT_TERMS_VERSION).toMatch(TERMS_VERSION_PATTERN);
    // The same pattern as public.users.terms_version's check (20261201090000_pilot_schema.sql).
    const migration = readFileSync(
      new URL('../../../supabase/migrations/20261201090000_pilot_schema.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain(`terms_version ~ '${TERMS_VERSION_PATTERN.source}'`);
  });

  it('is accepted by every demo account of the seed, so demos and browser tests go straight in', () => {
    const seed = readFileSync(new URL('../../../supabase/seed.sql', import.meta.url), 'utf8');
    expect(seed).toContain(`'${CURRENT_TERMS_VERSION}', now()`);
  });

  it('recognizes versions', () => {
    for (const ok of ['2026-11-pilote-1', '2027-01-v2', '2026-11-a']) {
      expect(isTermsVersion(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      '2026-11',
      '2026-11-',
      '26-11-pilote',
      '2026-11-Pilote',
      '2026-11-pilote 1',
    ]) {
      expect(isTermsVersion(bad), bad).toBe(false);
    }
    expect(isTermsVersion(`2026-11-${'a'.repeat(24)}`)).toBe(true);
    expect(isTermsVersion(`2026-11-${'a'.repeat(25)}`)).toBe(false);
  });

  it('asks first, then only signals a newer version', () => {
    expect(termsState(null)).toBe('required');
    expect(termsState(undefined)).toBe('required');
    expect(termsState(CURRENT_TERMS_VERSION)).toBe('accepted');
    expect(termsState('2026-09-pilote-0')).toBe('outdated');
    expect(termsState('2026-11-pilote-1', '2027-01-pilote-2')).toBe('outdated');
  });
});
