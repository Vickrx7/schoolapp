'use server';

import { fail, okVoid, type ActionResult } from '@/lib/action-result';
import { isLocale } from '@/i18n/config';
import { reportError } from '../errors';
import { writeLocaleCookie } from '../locale';
import { createSupabaseServerClient } from '../supabase';

/** Switches the interface language; remembers it on the profile when signed in. */
export async function setLocale(locale: string): Promise<ActionResult> {
  if (!isLocale(locale)) return fail('invalid');

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  await writeLocaleCookie(locale, { beforeSignIn: !auth.user });
  if (auth.user) {
    const { error } = await supabase
      .from('users')
      .update({ preferred_locale: locale })
      .eq('id', auth.user.id);
    if (error) return fail(reportError('setLocale', error));
  }
  return okVoid();
}
