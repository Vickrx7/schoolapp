'use client';

import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { revealClassAlerts, type StudentAlertView } from '@/server/actions/students';
import type { RosterStudent } from './types';

/**
 * A class's safety and medical alerts, hidden until tapped (a plan may be on a projected
 * screen). Every reveal goes through get_class_alerts, which audits it. The alerts are cleared
 * when hidden again and when the page is left or put away (`pagehide`).
 */
export function AlertsReveal({
  classId,
  className,
  showClassName,
  roster,
}: {
  classId: string;
  className: string;
  showClassName: boolean;
  roster: RosterStudent[];
}) {
  const t = useTranslations('subPlan.alerts');
  const tStudents = useTranslations('students.alerts');
  const [alerts, setAlerts] = useState<StudentAlertView[] | null>(null);
  const reveal = useAction(revealClassAlerts, { onSuccess: (data) => setAlerts(data) });

  useEffect(() => {
    const hide = () => setAlerts(null);
    window.addEventListener('pagehide', hide);
    return () => window.removeEventListener('pagehide', hide);
  }, []);

  const names = new Map(roster.map((s) => [s.id, s.firstName]));
  const label = showClassName ? `${t('show')} · ${className}` : t('show');

  if (!alerts) {
    return (
      <Button
        variant="secondary"
        onClick={() => void reveal.run(classId)}
        disabled={reveal.pending}
      >
        <Eye aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" onClick={() => setAlerts(null)}>
        <EyeOff aria-hidden />
        {showClassName ? `${t('hide')} · ${className}` : t('hide')}
      </Button>
      {alerts.length === 0 ? (
        <p className="text-sm text-slate-600">{t('none')}</p>
      ) : (
        <ul className="space-y-2" aria-label={label}>
          {alerts.map((a) => (
            <li
              key={a.alertId}
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
              <span>
                {t('item', {
                  name: names.get(a.studentId) ?? '—',
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
