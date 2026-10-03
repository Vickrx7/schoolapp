/**
 * The pilot terms (DECISIONS D-109, D-110). Every staff member accepts them at first sign-in
 * (« Bienvenue »); a newer version later shows a banner and never blocks work, so a sick teacher at
 * 6 a.m. is never stopped. The accepted version and time are stored on `public.users`
 * (`terms_version`, `terms_accepted_at`) and audited as `user.terms_accepted`.
 *
 * A version is `YYYY-MM-<slug>` (the same pattern as the database's check). Publish new terms by
 * changing `CURRENT_TERMS_VERSION` and adding its one-line « Ce qui a changé » to
 * `TERMS_CHANGES` (the message `welcome.changes.<key>`, in both languages; unit tests check
 * both): the seed's demo accounts accept the current version (`supabase/seed.sql`, checked by a
 * unit test).
 */

/** `YYYY-MM-` then 1 to 24 lowercase letters, digits or hyphens: `2026-11-pilote-1`. */
export const TERMS_VERSION_PATTERN = /^[0-9]{4}-[0-9]{2}-[a-z0-9-]{1,24}$/;

/**
 * The terms in force. Changing it shows everyone the « conditions ont changé » banner.
 * `2026-10-pilote-2` (Phase 6 review): the notice and « Bienvenue » say that only the names the
 * app knows are replaced before AI, who reads feedback, and how IP Lynx accesses the data.
 * `2026-10-pilote-3` (« Commentaires de bulletin », D-134): teachers may write report card
 * comments, which stay in their browser (never on our servers or with the AI) and are erased at
 * sign-out, when another account signs in, or 60 days after the report goes home.
 * `2026-10-pilote-4` (« Info-parents », D-143): the notice's purposes include messages to
 * families, which the app never sends; a class's messages are erased with its students' first
 * names; a new term says whom a message may name and to remove unknown people's names before
 * « Traduire en anglais (IA) ».
 * `2026-10-pilote-5` (post-MVP review, D-144): « Combien de temps » says when report card comments
 * really leave the device: at sign-out, or the first time the app opens in that browser for
 * another account or after their date (a browser where the app never opens again keeps them);
 * and the feedback kept a year is named as such.
 */
export const CURRENT_TERMS_VERSION = '2026-10-pilote-5';

/**
 * « Ce qui a changé » for each version, shown when newer terms are offered (never at a first
 * sign-in): the key of its one line under `welcome.changes` in the message catalogues.
 */
export const TERMS_CHANGES: Readonly<Record<string, string>> = {
  '2026-11-pilote-1': 'pilote1',
  '2026-10-pilote-2': 'pilote2',
  '2026-10-pilote-3': 'pilote3',
  '2026-10-pilote-4': 'pilote4',
  '2026-10-pilote-5': 'pilote5',
};

/** The message key of what `version` changed (`welcome.changes.<key>`), if any. */
export function termsChangeKey(version: string = CURRENT_TERMS_VERSION): string | null {
  return TERMS_CHANGES[version] ?? null;
}

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
