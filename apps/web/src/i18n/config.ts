export const locales = ['fr-CA', 'en-CA'] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = 'fr-CA';
export const LOCALE_COOKIE = 'locale';

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Picks the English label when the UI is in English and one exists, else the French one. */
export function localized(locale: string, fr: string, en: string | null | undefined): string {
  return locale.startsWith('en') && en ? en : fr;
}
