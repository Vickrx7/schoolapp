import type { ReportReminder } from '@lynx/domain';
import { CalendarClock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Notice } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';

/**
 * « Préparer mes commentaires » on « Aujourd'hui » (DECISIONS D-135): from 21 days before a
 * report period's « saisie » until that day, for each of the teacher's classes (homeroom or
 * subject, never a sample class), a link to that period in the class's « Bulletins ».
 */
export async function ReportReminders({
  reminders,
}: {
  reminders: ReportReminder<{ id: string; name: string; schoolYearId: string }>[];
}) {
  if (reminders.length === 0) return null;
  const t = await getTranslations('today.reportReminder');
  const tk = await getTranslations('reportPeriods.kinds');
  const locale = await getLocale();
  return (
    <div className="mb-4 space-y-2">
      {reminders.map((r) => {
        const date = formatLocalDate(r.date, locale, { day: 'numeric', month: 'short' });
        return (
          <Notice
            key={`${r.kind}:${r.date}`}
            tone="info"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
            data-testid="report-reminder"
          >
            <span className="flex items-center gap-2">
              <CalendarClock className="size-4 shrink-0" aria-hidden />
              {t(r.due ? 'due' : 'ends', { kind: tk(r.kind), date })}
            </span>
            <span className="flex flex-wrap gap-x-4">
              {r.classes.map((c) => (
                <Link
                  key={c.id}
                  href={`/classes/${c.id}/bulletins?period=${r.kind}`}
                  className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
                >
                  {r.classes.length > 1 ? t('actionFor', { className: c.name }) : t('action')}
                </Link>
              ))}
            </span>
          </Notice>
        );
      })}
    </div>
  );
}
