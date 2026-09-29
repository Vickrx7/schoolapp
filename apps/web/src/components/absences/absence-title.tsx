import { useLocale, useTranslations } from 'next-intl';
import { formatLocalDate } from '@/lib/format';

/** « Absence du lundi 5 octobre » or « Absence du jeudi 15 octobre au lundi 19 octobre ». */
export function useAbsenceTitle() {
  const t = useTranslations('absences');
  const locale = useLocale();
  return (absence: { startsOn: string; endsOn: string }) =>
    absence.startsOn === absence.endsOn
      ? t('titleOne', { date: formatLocalDate(absence.startsOn, locale) })
      : t('titleRange', {
          start: formatLocalDate(absence.startsOn, locale),
          end: formatLocalDate(absence.endsOn, locale),
        });
}
