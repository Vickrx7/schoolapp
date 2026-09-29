import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Badge } from '@/components/ui/card';
import { formatShortDate } from '@/lib/format';
import type { AbsenceRow } from '@/server/queries/absences';
import { capitalize } from './absence-summary';
import { useAbsenceTitle } from './absence-title';
import { PlanStatusBadge } from './plan-status-badge';

/** The teacher's absences, each with the release status of every school day. */
export function AbsenceList({
  absences,
  timezones,
}: {
  absences: AbsenceRow[];
  /** Time zone per school id, to show release times on the school's clock. */
  timezones: Record<string, string>;
}) {
  const t = useTranslations('absences');
  const locale = useLocale();
  const title = useAbsenceTitle();
  return (
    <ul className="space-y-3">
      {absences.map((a) => {
        const timeZone = timezones[a.schoolId] ?? 'America/Toronto';
        const several = a.plans.length > 1;
        return (
          <li key={a.id}>
            <Link
              href={`/absences/${a.id}`}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="font-semibold text-slate-900">{title(a)}</p>
                <p className="text-sm text-slate-600">{t(`part.${a.part}`)}</p>
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {a.refreshing ? (
                    <li>
                      <Badge tone="warning">{t('refreshing')}</Badge>
                    </li>
                  ) : null}
                  {a.plans.map((p) => (
                    <li
                      key={p.id}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-600"
                    >
                      {several ? capitalize(formatShortDate(p.planDate, locale)) : null}
                      <PlanStatusBadge plan={p} timeZone={timeZone} />
                    </li>
                  ))}
                </ul>
              </div>
              <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
