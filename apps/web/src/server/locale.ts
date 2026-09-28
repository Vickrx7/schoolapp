import 'server-only';
import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE, type AppLocale } from '@/i18n/config';
import { reportError } from './errors';
import type { createSupabaseServerClient } from './supabase';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const ONE_YEAR = 60 * 60 * 24 * 365;
/** Marks a language picked on the login page, so it wins over the account's saved one. */
const CHOSEN_BEFORE_SIGN_IN = 'locale_chosen';

export async function writeLocaleCookie(locale: AppLocale, { beforeSignIn = false } = {}) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
  if (beforeSignIn)
    store.set(CHOSEN_BEFORE_SIGN_IN, '1', {
      path: '/',
      maxAge: 60 * 60,
      sameSite: 'lax',
      httpOnly: true,
    });
}

/**
 * Right after sign-in: a language picked on the login page is saved to the account;
 * otherwise the account's saved language applies on this device. A language left on a
 * shared device by someone else never overwrites the next person's choice.
 */
export async function syncLocaleAtSignIn(supabase: SupabaseServerClient) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  const store = await cookies();
  const picked = store.get(CHOSEN_BEFORE_SIGN_IN) ? store.get(LOCALE_COOKIE)?.value : undefined;
  store.delete(CHOSEN_BEFORE_SIGN_IN);

  if (isLocale(picked)) {
    const { error } = await supabase
      .from('users')
      .update({ preferred_locale: picked })
      .eq('id', auth.user.id);
    if (error) reportError('syncLocaleAtSignIn', error);
    return;
  }
  const { data } = await supabase
    .from('users')
    .select('preferred_locale')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (data && isLocale(data.preferred_locale)) await writeLocaleCookie(data.preferred_locale);
}
