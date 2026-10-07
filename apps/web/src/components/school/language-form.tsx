'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Field, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { locales } from '@/i18n/config';
import { setLocale } from '@/server/actions/locale';

/** Switches the interface language right away; the page re-renders in the new language. */
export function LanguageForm() {
  const t = useTranslations('profile');
  const tLanguages = useTranslations('languages');
  const locale = useLocale();
  const router = useRouter();
  const change = useAction(setLocale, { onSuccess: () => router.refresh() });

  return (
    <Field label={t('language')} htmlFor="profile-language" hint={t('languageHint')}>
      <Select
        id="profile-language"
        value={locale}
        disabled={change.pending}
        onChange={(e) => void change.run(e.target.value)}
        className="sm:max-w-60"
      >
        {locales.map((l) => (
          <option key={l} value={l} lang={l}>
            {tLanguages(l)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
