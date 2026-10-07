'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/server/actions/locale';
import { setPortalLocale } from '@/server/actions/sub-portal';

/**
 * A one-click switch to the other interface language, for pages shown before sign-in. On the
 * substitute portal (`portal`), only the language cookie is written: no staff session is read.
 */
export function LanguageSwitch({ portal = false }: { portal?: boolean }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const target = t('otherLanguageLocale');

  const switchLanguage = () =>
    startTransition(async () => {
      try {
        const result = await (portal ? setPortalLocale : setLocale)(target);
        if (result.ok) router.refresh();
      } catch {
        // Offline: stay in the current language.
      }
    });

  return (
    <button
      type="button"
      lang={target}
      onClick={switchLanguage}
      disabled={pending}
      className="min-h-11 rounded-lg px-3 text-sm font-medium text-brand-700 underline underline-offset-2 hover:bg-brand-50 disabled:opacity-60"
    >
      {t('otherLanguage')}
    </button>
  );
}
