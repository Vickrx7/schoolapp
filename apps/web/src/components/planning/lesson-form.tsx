'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Notice } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { removeDrafts, useDraft } from '@/hooks/use-draft';
import { saveLesson } from '@/server/actions/planning';

/** Drafts saved before they were kept per user: another account's lesson may be in them. */
const LEGACY_DRAFT = /^lesson:[0-9a-f-]{36}:([0-9a-f-]{36}|new)$/;

export interface LessonDraft {
  title: string;
  objectives: string | null;
  materials: string | null;
  content: string | null;
  subNotes: string | null;
  durationMinutes: number | null;
  expectationIds: string[];
}

export interface ExpectationOption {
  id: string;
  code: string;
  text: string;
  kind: 'overall' | 'specific';
  verified: boolean;
  strand: string | null;
}

export function LessonForm({
  userId,
  classId,
  unitId,
  lessonId,
  initial,
  expectations,
  unitExpectationIds = [],
  onDone,
}: {
  userId: string;
  classId: string;
  unitId: string;
  lessonId?: string;
  initial?: LessonDraft;
  expectations: ExpectationOption[];
  /** The attentes the unit aims at (D-123), listed first as « Attentes de l'unité ». */
  unitExpectationIds?: string[];
  onDone: () => void;
}) {
  const t = useTranslations('lessons');
  const tCommon = useTranslations('common');
  const start = useMemo(
    () => ({
      title: initial?.title ?? '',
      objectives: initial?.objectives ?? '',
      materials: initial?.materials ?? '',
      content: initial?.content ?? '',
      subNotes: initial?.subNotes ?? '',
      duration: initial?.durationMinutes ? String(initial.durationMinutes) : '',
      expectationIds: initial?.expectationIds ?? [],
    }),
    [initial],
  );
  // Drafts are kept on this device until saved, so nothing is lost if the connection drops.
  // Per user, so another account on a shared computer never gets them.
  const draft = useDraft(`lesson:${userId}:${unitId}:${lessonId ?? 'new'}`, start);
  useEffect(() => removeDrafts((key) => LEGACY_DRAFT.test(key)), []);
  const v = draft.value;
  const save = useAction(saveLesson, {
    successMessage: t('saved'),
    onSuccess: () => {
      draft.clear();
      onDone();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(
      classId,
      unitId,
      {
        title: v.title,
        objectives: v.objectives,
        materials: v.materials,
        content: v.content,
        subNotes: v.subNotes,
        durationMinutes: v.duration === '' ? null : Number(v.duration),
        expectationIds: v.expectationIds,
      },
      lessonId,
    );
  };

  // « Attentes de l'unité » first, then the others by domaine.
  const unitIds = new Set(unitExpectationIds);
  const groups = [
    {
      key: 'unit',
      label: unitIds.size ? t('unitExpectations') : '',
      items: expectations.filter((e) => unitIds.has(e.id)),
    },
    ...[...new Set(expectations.map((e) => e.strand ?? ''))].map((strand) => ({
      key: `strand:${strand}`,
      label: strand,
      items: expectations.filter((e) => (e.strand ?? '') === strand && !unitIds.has(e.id)),
    })),
  ].filter((g) => g.items.length > 0);
  const others = unitIds.size > 0 && groups.length > 1;
  const toggle = (id: string) =>
    draft.update(
      'expectationIds',
      v.expectationIds.includes(id)
        ? v.expectationIds.filter((x) => x !== id)
        : [...v.expectationIds, id],
    );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {draft.restored ? (
        <Notice className="flex items-center justify-between gap-2">
          <span>{tCommon('draftRestored')}</span>
          <Button variant="ghost" size="sm" onClick={draft.discard}>
            {tCommon('discardDraft')}
          </Button>
        </Notice>
      ) : null}
      <Field label={t('lessonTitle')} htmlFor="lesson-title" error={save.fieldError('title')}>
        <Input
          id="lesson-title"
          value={v.title}
          maxLength={160}
          onChange={(e) => draft.update('title', e.target.value)}
        />
      </Field>
      <Field label={`${t('objectives')} (${tCommon('optional')})`} htmlFor="lesson-objectives">
        <Textarea
          id="lesson-objectives"
          value={v.objectives}
          onChange={(e) => draft.update('objectives', e.target.value)}
          className="min-h-16"
        />
      </Field>
      <Field label={`${t('materials')} (${tCommon('optional')})`} htmlFor="lesson-materials">
        <Textarea
          id="lesson-materials"
          value={v.materials}
          onChange={(e) => draft.update('materials', e.target.value)}
          className="min-h-16"
        />
      </Field>
      <Field label={`${t('content')} (${tCommon('optional')})`} htmlFor="lesson-content">
        <Textarea
          id="lesson-content"
          value={v.content}
          onChange={(e) => draft.update('content', e.target.value)}
          className="min-h-32"
        />
      </Field>
      <Field
        label={`${t('subNotes')} (${tCommon('optional')})`}
        htmlFor="lesson-subnotes"
        hint={t('subNotesHint')}
      >
        <Textarea
          id="lesson-subnotes"
          value={v.subNotes}
          onChange={(e) => draft.update('subNotes', e.target.value)}
          className="min-h-16"
        />
      </Field>
      <Field
        label={`${t('duration')} (${tCommon('optional')})`}
        htmlFor="lesson-duration"
        error={save.fieldError('durationMinutes')}
        className="max-w-40"
      >
        <Input
          id="lesson-duration"
          inputMode="numeric"
          value={v.duration}
          onChange={(e) => draft.update('duration', e.target.value.replace(/\D/g, '').slice(0, 3))}
        />
      </Field>
      {expectations.length ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">{t('expectations')}</legend>
          <p className="text-sm text-slate-500">{t('expectationsHint')}</p>
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
            {groups.map((group, i) => (
              <div key={group.key}>
                {others && i === 1 ? (
                  <p className="mb-1 text-sm font-semibold text-slate-700">
                    {t('otherExpectations')}
                  </p>
                ) : null}
                {group.label ? (
                  <p
                    className={
                      group.key === 'unit'
                        ? 'mb-1 text-sm font-semibold text-slate-700'
                        : 'mb-1 text-xs font-semibold text-slate-500 uppercase'
                    }
                  >
                    {group.label}
                  </p>
                ) : null}
                <ul className="space-y-1">
                  {group.items.map((e) => (
                    <li key={e.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded p-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0"
                          checked={v.expectationIds.includes(e.id)}
                          onChange={() => toggle(e.id)}
                        />
                        <span>
                          <span className="font-semibold">{e.code}</span> {e.text}{' '}
                          {!e.verified ? <Badge tone="warning">{t('unverified')}</Badge> : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" disabled={save.pending || !v.title.trim()}>
          {save.pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </form>
  );
}
