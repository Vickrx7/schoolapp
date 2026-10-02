/**
 * The pilot terms (DECISIONS D-109, D-110). Every staff member accepts them at first sign-in
 * (« Bienvenue »); a newer version later shows a banner and never blocks work, so a sick teacher at
 * 6 a.m. is never stopped. The accepted version and time are stored on `public.users`
 * (`terms_version`, `terms_accepted_at`) and audited as `user.terms_accepted`.
 *
 * A version is `YYYY-MM-<slug>` (the same pattern as the database's check). Publish new terms by
 * changing `CURRENT_TERMS_VERSION`: the seed's demo accounts accept the current version
 * (`supabase/seed.sql`, checked by a unit test).
 */

/** `YYYY-MM-` then 1 to 24 lowercase letters, digits or hyphens: `2026-11-pilote-1`. */
export const TERMS_VERSION_PATTERN = /^[0-9]{4}-[0-9]{2}-[a-z0-9-]{1,24}$/;

/** The terms in force. Changing it shows everyone the « conditions ont changé » banner. */
export const CURRENT_TERMS_VERSION = '2026-11-pilote-1';

export function isTermsVersion(value: string): boolean {
  return TERMS_VERSION_PATTERN.test(value);
}

/**
 * Where a person stands with the terms: `required` (never accepted: « Bienvenue » first),
 * `outdated` (an older version: a banner, never a block) or `accepted`.
 */
export type TermsState = 'required' | 'outdated' | 'accepted';

export function termsState(
  acceptedVersion: string | null | undefined,
  current: string = CURRENT_TERMS_VERSION,
): TermsState {
  if (!acceptedVersion) return 'required';
  return acceptedVersion === current ? 'accepted' : 'outdated';
}
