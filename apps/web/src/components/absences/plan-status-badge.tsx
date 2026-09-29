import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/card';
import { formatLocalDate, formatTime } from '@/lib/format';
import { planStatusView } from './plan-status';

/**
 * « Prêt · publié automatiquement à 7 h 30 » or « Publié ». `withDate` names the day even when
 * the release is on the plan date (lists that show several days).
 */
export function PlanStatusBadge({
  plan,
  timeZone,
  withDate = false,
}: {
  plan: { planDate: string; released: boolean; releaseAt: string };
  timeZone: string;
  withDate?: boolean;
}) {
  const t = useTranslations('absences.status');
  const locale = useLocale();
  const view = planStatusView(plan, timeZone);
  let label: string;
  if (view.kind === 'released') {
    label = t('released');
  } else if (withDate || !view.onPlanDate) {
    label = t('readyOn', {
      date: formatLocalDate(view.date, locale, { weekday: 'long', day: 'numeric', month: 'short' }),
      time: formatTime(view.time, locale),
    });
  } else {
    label = t('ready', { time: formatTime(view.time, locale) });
  }
  return (
    <Badge tone={view.kind === 'released' ? 'success' : 'brand'} data-testid="plan-status">
      {label}
    </Badge>
  );
}
