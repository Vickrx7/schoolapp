'use client';

import { useLocale, useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';
import { capitalize } from '@/components/absences/absence-summary';
import { formatInstantTime, formatLocalDate } from '@/lib/format';
import type { ShownCode, SubCodeContext } from './types';

/**
 * « Feuille d'accueil »: a one-page print-out for the substitute, made in the browser (nothing
 * is stored). While it is on the page it is the only thing printed (globals.css). It never
 * holds student names or alerts.
 */
export function WelcomeSheet({ context, shown }: { context: SubCodeContext; shown: ShownCode }) {
  const t = useTranslations('subCodes.sheet');
  const locale = useLocale();
  const shortUrl = `${shown.baseUrl.replace(/^https?:\/\//, '')}/s`;

  return createPortal(
    <section
      data-print-sheet
      className="hidden space-y-5 p-8 font-serif text-black print:block"
      aria-hidden
    >
      <header className="space-y-1 border-b border-gray-400 pb-3">
        <p className="text-sm">{context.schoolName}</p>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-lg">{capitalize(formatLocalDate(context.planDate, locale))}</p>
        <p className="text-lg font-bold">{t('classOf', { name: context.teacherName })}</p>
        <p>
          {[
            ...context.classNames,
            context.roomNames.length > 0 ? t('room', { room: context.roomNames.join(', ') }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <div className="space-y-2 rounded-lg border-2 border-black p-5 text-center">
        <p className="text-sm tracking-wide uppercase">{t('code')}</p>
        <p className="font-mono text-5xl font-bold tracking-widest">{shown.code}</p>
        <p className="pt-2">{t('open')}</p>
        <p className="font-mono text-2xl">{shortUrl}</p>
        <p className="pt-2">
          {t('valid', {
            date: formatLocalDate(context.planDate, locale),
            from: formatInstantTime(shown.validFrom, context.timezone, locale),
            until: formatInstantTime(shown.expiresAt, context.timezone, locale),
          })}
        </p>
      </div>

      {context.officePhone ? (
        <p className="text-lg">{t('office', { phone: context.officePhone })}</p>
      ) : null}
      {context.arrivalInstructions ? (
        <div>
          <p className="font-bold">{t('arrival')}</p>
          <p className="whitespace-pre-line">{context.arrivalInstructions}</p>
        </div>
      ) : null}
      <p className="border-t border-gray-400 pt-3 font-bold">{t('keep')}</p>
    </section>,
    document.body,
  );
}
