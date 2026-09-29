'use client';

import { ArrowDown, ArrowUp, Library, Pencil, Plus, Trash2, Unlink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { CheckOffButton } from '@/components/app/check-off-button';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/page';
import { useAction } from '@/hooks/use-action';
import { formatLocalDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { detachItemFromLesson } from '@/server/actions/library-planning';
import { deleteLesson, moveLesson } from '@/server/actions/planning';
import { AttachResourceLink } from './attach-resource-link';
import { LessonForm, type ExpectationOption, type LessonDraft } from './lesson-form';

export interface LessonItem extends LessonDraft {
  id: string;
  sequenceNumber: number;
  status: 'completed' | 'skipped' | 'pending_confirmation' | null;
  taughtOn: string | null;
  /** For a lesson a substitute reported: the report where it is confirmed. */
  pendingReport: { absenceId: string; planId: string } | null;
  /** The library resource attached to the lesson (D-076), if the teacher can open it. */
  resource: { id: string; title: string } | null;
  /** A resource is attached that the teacher can no longer open (withdrawn, unshared). */
  hasHiddenResource: boolean;
}

export function LessonList({
  userId,
  classId,
  unitId,
  lessons,
  nextLessonId,
  today,
  expectations,
  library,
}: {
  /** The signed-in user: drafts are kept per user. */
  userId: string;
  classId: string;
  unitId: string;
  lessons: LessonItem[];
  nextLessonId: string | null;
  today: string;
  expectations: ExpectationOption[];
  /**
   * « Joindre une ressource » (D-076): the class's grade and the unit's subject open the library
   * on the right results; null when the teacher has no library screens (D-078).
   */
  library: { gradeCode: string | null; subjectId: string | null } | null;
}) {
  const t = useTranslations('lessons');
  const tCommon = useTranslations('common');
  const tReport = useTranslations('subReport');
  const tLibrary = useTranslations('libraryPlanning.lessonRow');
  const locale = useLocale();
  const [editing, setEditing] = useState<LessonItem | 'new' | null>(null);
  const move = useAction(moveLesson);
  const remove = useAction(deleteLesson, { successMessage: t('deleted') });
  const detach = useAction(detachItemFromLesson, { successMessage: tLibrary('detached') });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t('title')}</h3>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          {t('add')}
        </Button>
      </div>

      {lessons.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ol className="space-y-2">
          {lessons.map((l, i) => {
            const taught = l.status === 'completed' || l.status === 'skipped';
            // Reported by a substitute: confirmed through the report only (D-054).
            const pending = l.status === 'pending_confirmation';
            return (
              <li key={l.id}>
                <Card className={cn('p-3', l.id === nextLessonId && 'ring-2 ring-brand-400')}>
                  <div className="flex flex-wrap items-start gap-3">
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                        taught
                          ? 'bg-emerald-100 text-emerald-800'
                          : pending
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-slate-100 text-slate-700',
                      )}
                    >
                      {l.sequenceNumber}
                    </span>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="font-medium">{l.title}</p>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-sm text-slate-600">
                        {l.id === nextLessonId ? <Badge tone="brand">{t('next')}</Badge> : null}
                        {taught && l.taughtOn ? (
                          <span>
                            {t('taughtOn', {
                              date: formatLocalDate(l.taughtOn, locale, {
                                day: 'numeric',
                                month: 'long',
                              }),
                            })}
                          </span>
                        ) : null}
                        {l.expectationIds.length ? (
                          <span>
                            {expectations
                              .filter((e) => l.expectationIds.includes(e.id))
                              .map((e) => e.code)
                              .join(', ')}
                          </span>
                        ) : null}
                      </div>
                      {l.resource || l.hasHiddenResource ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {l.resource ? (
                            <Link
                              href={`/library/items/${l.resource.id}`}
                              className="inline-flex min-h-11 items-center gap-1 rounded-full bg-brand-50 px-3 text-sm font-medium text-brand-800 underline-offset-2 hover:underline"
                              data-testid="lesson-resource-chip"
                            >
                              <Library className="size-4 shrink-0" aria-hidden />
                              <span>
                                {tLibrary.rich('chipTitle', {
                                  title: l.resource.title,
                                  name: (chunks) => <span className="font-normal">{chunks}</span>,
                                })}
                              </span>
                            </Link>
                          ) : (
                            <Badge data-testid="lesson-resource-chip">{tLibrary('hidden')}</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-11"
                            disabled={detach.pending}
                            aria-label={tLibrary('detachNamed', { n: l.sequenceNumber })}
                            onClick={() => void detach.run(l.id)}
                          >
                            <Unlink aria-hidden />
                            {tLibrary('detach')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {pending ? (
                        l.pendingReport ? (
                          <Link
                            href={`/absences/${l.pendingReport.absenceId}/plans/${l.pendingReport.planId}/report`}
                            className="inline-flex min-h-11 items-center rounded-full bg-amber-100 px-3 text-sm font-medium text-amber-900 underline-offset-2 hover:underline"
                            data-testid="pending-chip"
                          >
                            {tReport('pendingChip')}
                          </Link>
                        ) : (
                          <Badge tone="warning" data-testid="pending-chip">
                            {tReport('pendingChip')}
                          </Badge>
                        )
                      ) : (
                        <CheckOffButton
                          lessonId={l.id}
                          lessonTitle={l.title}
                          date={today}
                          taught={taught}
                          size="sm"
                        />
                      )}
                      {library ? (
                        <AttachResourceLink
                          lessonId={l.id}
                          lessonNumber={l.sequenceNumber}
                          gradeCode={library.gradeCode}
                          subjectId={library.subjectId}
                          expectationId={l.expectationIds[0] ?? null}
                        />
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tCommon('moveUp')}
                        disabled={i === 0 || move.pending}
                        onClick={() => void move.run(classId, unitId, l.id, 'up')}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tCommon('moveDown')}
                        disabled={i === lessons.length - 1 || move.pending}
                        onClick={() => void move.run(classId, unitId, l.id, 'down')}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tCommon('edit')}
                        onClick={() => setEditing(l)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <ConfirmButton
                        label={tCommon('delete')}
                        message={t('deleteConfirm', { title: l.title })}
                        confirmLabel={tCommon('delete')}
                        variant="ghost"
                        size="icon"
                        onConfirm={() => remove.run(classId, unitId, l.id)}
                      >
                        <Trash2 aria-hidden />
                      </ConfirmButton>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing !== null ? (
          <DialogContent
            title={editing === 'new' ? t('add') : t('edit')}
            closeLabel={tCommon('close')}
            className="sm:max-w-2xl"
          >
            <LessonForm
              userId={userId}
              classId={classId}
              unitId={unitId}
              lessonId={editing === 'new' ? undefined : editing.id}
              initial={editing === 'new' ? undefined : editing}
              expectations={expectations}
              onDone={() => setEditing(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
