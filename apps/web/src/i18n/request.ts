import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { SURFACE_HEADER } from '@/lib/surface';
import { defaultLocale, isLocale, LOCALE_COOKIE } from './config';

// French by default. The language comes from a cookie set from the user's saved preference
// (profile page, or the switch on the login page); see DECISIONS.md, D-033.
//
// Student devices (/jouer, « Quiz sur les appareils ») are always in French, whatever the
// device's cookie, and get only the `classPortal` messages (D-090) and the error page's
// « Signaler le problème » (`problemReport`, D-111): the root layout serializes the request's
// messages into every page, and no staff catalogue may reach a student device.
// proxy.ts sets the surface header on every request, overwriting any value a client sent.
export default getRequestConfig(async () => {
  if ((await headers()).get(SURFACE_HEADER) === 'jouer') {
    const all = (await import('../../messages/fr-CA.json')).default;
    return {
      locale: 'fr-CA',
      messages: { classPortal: all.classPortal, problemReport: all.problemReport },
      timeZone: 'America/Toronto',
    };
  }
  const store = await cookies();
  const requested = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(requested) ? requested : defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'America/Toronto',
  };
});
