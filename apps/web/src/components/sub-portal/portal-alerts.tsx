'use client';

import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { RosterStudent } from '@/components/sub-plans/types';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { useHideWhenAway } from '@/hooks/use-hide-when-away';
import { revealSubAlerts, type SubAlertView } from '@/server/actions/sub-portal';

/**
 * « Alertes de sécurité ou médicales » for the substitute (DECISIONS D-056): hidden until
 * tapped (the plan may be on a projected screen), every tap audited per class by the database,
 * and cleared when hidden again, when the phone is locked or another tab or app comes to the
 * front, and when the page is left (useHideWhenAway).
 */
export function PortalAlerts({
  contentVersion,
  roster,
  classNames,
}: {
  contentVersion: number;
  roster: RosterStudent[];
  /** Class names by id, to tell students apart when the plan covers several classes. */
  classNames: Record<string, string>;
}) {
  const t = useTranslations('subPortal');
  const tStudents = useTranslations('students.alerts');
  const router = useRouter();
  const [alerts, setAlerts] = useState<SubAlertView[] | null>(null);
  const reveal = useAction(revealSubAlerts, {
    onSuccess: (result) => {
      if (result.status === 'ok') setAlerts(result.alerts);
      else if (result.status === 'expired') router.replace('/suppleance?ended=1');
      else router.refresh();
    },
  });

  useHideWhenAway(useCallback(() => setAlerts(null), []));

  const names = new Map(roster.map((s) => [s.id, s.firstName]));
  const multipleClasses = new Set(alerts?.map((a) => a.classId) ?? []).size > 1;

  if (!alerts) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">{t('alertsHint')}</p>
        <Button
          variant="secondary"
          onClick={() => void reveal.run(contentVersion)}
          disabled={reveal.pending}
        >
          <Eye aria-hidden />
          {t('alertsButton')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" onClick={() => setAlerts(null)}>
        <EyeOff aria-hidden />
        {t('alertsHide')}
      </Button>
      {alerts.length === 0 ? (
        <p className="text-sm text-slate-600">{t('alertsNone')}</p>
      ) : (
        <ul className="space-y-2" aria-label={t('alertsButton')}>
          {alerts.map((a) => (
            <li
              key={a.alertId}
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
              <span>
                {t('alertsItem', {
                  name: multipleClasses
                    ? `${names.get(a.studentId) ?? '—'} (${classNames[a.classId] ?? ''})`
                    : (names.get(a.studentId) ?? '—'),
                  category: tStudents(`categories.${a.category}`),
                  text: a.text ?? tStudents('unreadable'),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
