'use client';

import type { ConfirmDecision } from '@lynx/domain';
import { CheckCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useAction } from '@/hooks/use-action';
import { confirmSubReport } from '@/server/actions/sub-reports';
import type { ReportLessonView } from '@/server/queries/sub-reports';
import { ReportLessonHeader } from './report-details';

const DECISIONS: ConfirmDecision[] = ['completed', 'not_completed', 'skipped'];

/**
 * « Suivi de la suppléance » for the absent teacher (DECISIONS D-054): each lesson with what the
 * substitute said, and « Confirmer / Pas terminée / Sautée », preselected from the report. « Tout
 * confirmer » sets every lesson to « Confirmer »; « Confirmer le suivi » finishes. A lesson she
 * already checked off herself keeps her record and is not asked about.
 */
export function ConfirmReport({
  reportId,
  lessons,
}: {
  reportId: string;
  lessons: ReportLessonView[];
}) {
  const t = useTranslations('subReport');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const asked = lessons.filter((l) => !l.recordedElsewhere);
  const [decisions, setDecisions] = useState<Record<string, ConfirmDecision>>(() =>
    Object.fromEntries(asked.map((l) => [l.lessonId, l.decision])),
  );
  const confirm = useAction(confirmSubReport, {
    successMessage: t('confirmedToast'),
    onSuccess: () => router.refresh(),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm.run(
          reportId,
          asked.map((l) => ({ lessonId: l.lessonId, decision: decisions[l.lessonId]! })),
        );
      }}
    >
      <p className="text-sm text-slate-600">{t('confirmHint')}</p>
      <ol className="space-y-3">
        {lessons.map((lesson) => {
          const headingId = `${id}-${lesson.lessonId}`;
          return (
            <li
              key={lesson.lessonId}
              data-testid="confirm-lesson"
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <ReportLessonHeader lesson={lesson} headingId={headingId} locale={locale} />
              {lesson.recordedElsewhere ? (
                <p className="text-sm text-slate-600">{t('recordedElsewhere')}</p>
              ) : (
                <div role="radiogroup" aria-labelledby={headingId} className="flex flex-wrap gap-2">
                  {DECISIONS.map((decision) => (
                    <Chip
                      key={decision}
                      name={`${id}-decision-${lesson.lessonId}`}
                      value={decision}
                      checked={decisions[lesson.lessonId] === decision}
                      onChange={() =>
                        setDecisions((prev) => ({ ...prev, [lesson.lessonId]: decision }))
                      }
                    >
                      {t(`decision.${decision}`)}
                    </Chip>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        {asked.length > 1 ? (
          <Button
            variant="secondary"
            onClick={() =>
              setDecisions(Object.fromEntries(asked.map((l) => [l.lessonId, 'completed'])))
            }
          >
            <CheckCheck aria-hidden />
            {t('confirmAll')}
          </Button>
        ) : null}
        <Button type="submit" disabled={confirm.pending}>
          {confirm.pending ? t('confirming') : t('confirm')}
        </Button>
      </div>
    </form>
  );
}
