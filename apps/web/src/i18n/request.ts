import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const locales = ['fr-CA', 'en-CA'] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = 'fr-CA';

// UI is French for the pilot. The locale comes from the user's preference cookie so an
// English UI can be added by providing messages/en-CA.json (see DECISIONS.md, D-033).
export default getRequestConfig(async () => {
  const store = await cookies();
  const requested = store.get('locale')?.value;
  const available: readonly string[] = ['fr-CA'];
  const locale = requested && available.includes(requested) ? requested : defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'America/Toronto',
  };
});
