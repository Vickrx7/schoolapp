import { Phone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatInstantTime, formatLocalDate } from '@/lib/format';

/**
 * The top of the substitute's plan, kept in view while scrolling: the school, the class(es) and
 * room, the office's number, and until when the access works. `updatedAt` is set when the
 * teacher changed the plan after it was released (« Mis à jour à 9 h 12 »).
 */
export function PortalHeader({
  schoolName,
  classes,
  rooms,
  planDate,
  teacherName,
  officePhone,
  expiresAt,
  updatedAt,
  timeZone,
}: {
  schoolName: string;
  classes: string[];
  rooms: string[];
  planDate: string;
  teacherName: string;
  officePhone: string | null;
  expiresAt: string;
  updatedAt: string | null;
  timeZone: string;
}) {
  const t = useTranslations('subPortal');
  const tPlan = useTranslations('subPlan');
  const locale = useLocale();
  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:static">
      <p className="text-xs font-medium text-slate-500">{schoolName}</p>
      <p className="font-semibold text-slate-900">
        {classes.length > 0 ? classes.join(' · ') : tPlan('classOf', { name: teacherName })}
      </p>
      <p className="text-sm text-slate-600">
        {[formatLocalDate(planDate, locale), ...rooms].join(' · ')}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {officePhone ? (
          <a
            href={`tel:${officePhone.replace(/[^\d+]/g, '')}`}
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-brand-700 underline underline-offset-2"
          >
            <Phone className="size-4" aria-hidden />
            {t('office', { phone: officePhone })}
          </a>
        ) : null}
        <span className="text-slate-600">
          {t('validUntil', { time: formatInstantTime(expiresAt, timeZone, locale) })}
        </span>
        {updatedAt ? (
          <span className="font-medium text-amber-800" data-testid="plan-updated">
            {t('updated', { time: formatInstantTime(updatedAt, timeZone, locale) })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
