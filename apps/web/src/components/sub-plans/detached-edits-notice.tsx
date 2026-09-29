'use client';

import type { DetachedEdit } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * « Le plan a changé depuis vos modifications »: edits written for a lesson the block no longer
 * has. They are hidden from everyone else until the teacher applies them to the new lesson or
 * deletes them (D-048).
 */
export function DetachedEditsNotice({
  detached,
  disabled,
  onApply,
  onDiscard,
}: {
  detached: DetachedEdit[];
  disabled: boolean;
  onApply: (edit: DetachedEdit) => void;
  onDiscard: (edit: DetachedEdit) => void;
}) {
  const t = useTranslations('subPlan.detached');
  if (detached.length === 0) return null;
  return (
    <section
      aria-labelledby="plan-detached"
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <h2 id="plan-detached" className="font-semibold">
        {t('title')}
      </h2>
      <ul className="space-y-3">
        {detached.map((d) => (
          <li key={d.blockKey} className="space-y-2">
            <p>
              {d.reason === 'lesson_changed'
                ? t('lessonChanged', { block: d.blockTitle ?? '' })
                : t('blockRemoved')}
            </p>
            {d.steps?.length ? (
              <ol className="list-decimal space-y-0.5 pl-5 text-amber-950">
                {d.steps.map((s, i) => (
                  <li key={i}>{s.text}</li>
                ))}
              </ol>
            ) : null}
            {d.teacherNote ? <p className="italic">{d.teacherNote}</p> : null}
            <div className="flex flex-wrap gap-2">
              {d.reason === 'lesson_changed' ? (
                <Button variant="secondary" disabled={disabled} onClick={() => onApply(d)}>
                  {t('apply')}
                </Button>
              ) : null}
              <Button variant="ghost" disabled={disabled} onClick={() => onDiscard(d)}>
                {t('discard')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
