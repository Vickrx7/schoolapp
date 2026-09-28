'use client';

import type { Segment } from '@lynx/ai/privacy';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { removeDrafts, useDraft } from '@/hooks/use-draft';
import {
  previewDifferentiation,
  requestDifferentiation,
  type PreviewResult,
} from '@/server/actions/differentiate';
import type { DifferentiateFormContext, JobSummary } from '@/server/queries/differentiate';
import { aiStatus } from './ai-status';
import {
  defaultFormValues,
  effectiveFormValues,
  subjectFitsGrade,
  subjectsForGrade,
  type FormValues,
  type ItemType,
} from './form-values';

/** Drafts saved before they were kept per user: another account's text may be in them. */
const LEGACY_DRAFT = /^differentiate:(new|job:[0-9a-f-]{36}|saved:[0-9a-f-]{36})$/;

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.placeholder ? (
          <mark key={i} className="rounded bg-brand-100 px-1 font-medium text-brand-800">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function DifferentiateForm({
  context,
  jobStatuses,
  resume,
}: {
  context: DifferentiateFormContext;
  /** Status of the recent requests, to know what became of a draft that was sent. */
  jobStatuses: Record<string, JobSummary['status']>;
  /** An earlier request to send again (from its page's « Reprendre ce texte »). */
  resume?: { jobId: string; values: FormValues } | null;
}) {
  const t = useTranslations('differentiate');
  const tCommon = useTranslations('common');
  const router = useRouter();
  // Per user (a shared computer), and per reused request so it never overwrites another draft.
  const draftKey = `differentiate:new:${context.userId}${resume ? `:${resume.jobId}` : ''}`;
  const draft = useDraft(draftKey, resume?.values ?? defaultFormValues(context), {
    // A sent draft is kept until its request succeeds; it comes back only if the request failed.
    sentPolicy: (jobId) => {
      const status = jobStatuses[jobId];
      return status === 'failed' ? 'restore' : status === 'succeeded' ? 'drop' : 'keep';
    },
  });
  // A restored draft can name a school, grade, subject or level that no longer applies.
  const v = effectiveFormValues(draft.value, context);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const school = context.schools.find((s) => s.id === v.schoolId);
  const grade = context.grades.find((g) => g.code === v.gradeCode);
  const subjects = subjectsForGrade(context.subjects, grade);
  const schoolLevels = context.levels.filter((l) => !school || l.boardId === school.boardId);

  useEffect(() => removeDrafts((key) => LEGACY_DRAFT.test(key)), []);

  const form = () => ({
    schoolId: v.schoolId,
    title: v.title,
    text: v.text,
    objective: v.objective,
    itemType: v.itemType,
    gradeCode: v.gradeCode,
    subjectId: v.subjectId || null,
    levelIds: v.levelIds,
  });

  const check = useAction(previewDifferentiation, { onSuccess: setPreview });
  const send = useAction(requestDifferentiation, {
    onSuccess: ({ jobId }) => {
      // Not cleared yet: if the request fails, the teacher gets their text back (D-035).
      draft.markSent(jobId, v);
      router.push(`/differentiate/${jobId}`);
    },
  });

  // Any change invalidates the preview: what is sent must be what was checked.
  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setPreview(null);
    draft.update(key, value);
  };

  // A subject that isn't taught in the new grade is cleared, not kept out of sight.
  const changeGrade = (gradeCode: string) => {
    setPreview(null);
    draft.setValue((prev) => ({
      ...prev,
      gradeCode,
      subjectId: subjectFitsGrade(context, prev.subjectId, gradeCode) ? prev.subjectId : '',
    }));
  };

  const toggleLevel = (id: string, on: boolean) =>
    update('levelIds', on ? [...v.levelIds, id] : v.levelIds.filter((l) => l !== id));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void check.run(form());
  };

  const ai = school ? aiStatus(school) : 'off';
  const aiOff = ai !== 'on';
  const fieldError = (name: string) => check.fieldError(name) ?? send.fieldError(name);

  return (
    <div className="space-y-4">
      {draft.restored ? (
        <Notice tone="info" className="flex flex-wrap items-center justify-between gap-2">
          <span>{draft.sentAs ? t('failedDraftRestored') : tCommon('draftRestored')}</span>
          <Button variant="ghost" onClick={() => draft.discard()}>
            {tCommon('discardDraft')}
          </Button>
        </Notice>
      ) : null}
      {resume && !draft.restored ? <Notice tone="info">{t('resumed')}</Notice> : null}
      {ai === 'boardOff' ? <Notice tone="warning">{t('aiBoardOffNotice')}</Notice> : null}
      {ai === 'off' ? <Notice tone="warning">{t('aiOffNotice')}</Notice> : null}

      <Card>
        <CardBody className="pt-4">
          <form onSubmit={submit} className="space-y-4" noValidate>
            {context.schools.length > 1 ? (
              <Field label={t('school')} htmlFor="diff-school">
                <Select
                  id="diff-school"
                  value={v.schoolId}
                  onChange={(e) => update('schoolId', e.target.value)}
                >
                  {context.schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('titleLabel')} htmlFor="diff-title" error={fieldError('title')}>
                <Input
                  id="diff-title"
                  value={v.title}
                  maxLength={200}
                  onChange={(e) => update('title', e.target.value)}
                />
              </Field>
              <Field label={t('itemType')} htmlFor="diff-type">
                <Select
                  id="diff-type"
                  value={v.itemType}
                  onChange={(e) => update('itemType', e.target.value as ItemType)}
                >
                  <option value="reading_passage">{t('itemTypes.reading_passage')}</option>
                  <option value="worksheet">{t('itemTypes.worksheet')}</option>
                </Select>
              </Field>
              <Field label={t('grade')} htmlFor="diff-grade" error={fieldError('gradeCode')}>
                <Select
                  id="diff-grade"
                  value={v.gradeCode}
                  onChange={(e) => changeGrade(e.target.value)}
                >
                  {context.grades.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('subject')} htmlFor="diff-subject">
                <Select
                  id="diff-subject"
                  value={v.subjectId}
                  onChange={(e) => update('subjectId', e.target.value)}
                >
                  <option value="">{tCommon('noneF')}</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label={t('textLabel')}
              htmlFor="diff-text"
              hint={t('textHint')}
              error={fieldError('text')}
            >
              <Textarea
                id="diff-text"
                value={v.text}
                maxLength={12_000}
                onChange={(e) => update('text', e.target.value)}
                className="min-h-56"
                spellCheck
              />
            </Field>

            <Field
              label={
                <>
                  {t('objectiveLabel')}{' '}
                  <span className="font-normal text-slate-500">({tCommon('optional')})</span>
                </>
              }
              htmlFor="diff-objective"
              hint={t('objectiveHint')}
              error={fieldError('objective')}
            >
              <Input
                id="diff-objective"
                value={v.objective}
                maxLength={500}
                onChange={(e) => update('objective', e.target.value)}
              />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">{t('levels')}</legend>
              <p className="text-sm text-slate-500">
                {t('levelsHint')}{' '}
                <Link href="/differentiate/levels" className="text-brand-700 underline">
                  {t('manageLevels')}
                </Link>
              </p>
              <div className="flex flex-wrap gap-2">
                {schoolLevels.map((l) => (
                  <label
                    key={l.id}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      checked={v.levelIds.includes(l.id)}
                      onChange={(e) => toggleLevel(l.id, e.target.checked)}
                    />
                    <span>{l.label}</span>
                    {l.personal ? (
                      <span className="text-xs text-slate-500">({t('personalLevel')})</span>
                    ) : null}
                  </label>
                ))}
              </div>
              {fieldError('levelIds') ? (
                <p className="text-sm text-red-600" role="alert">
                  {fieldError('levelIds')}
                </p>
              ) : null}
            </fieldset>

            {!preview ? (
              <Button type="submit" disabled={check.pending || aiOff}>
                <ShieldCheck aria-hidden />
                {check.pending ? tCommon('loading') : t('preview')}
              </Button>
            ) : null}
          </form>
        </CardBody>
      </Card>

      {preview ? (
        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>{t('previewTitle')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-slate-600">{t('previewIntro')}</p>
            {preview.blocked.length ? (
              <Notice tone="danger" className="space-y-2">
                <p className="flex items-center gap-2 font-medium">
                  <TriangleAlert className="size-4" aria-hidden />
                  {t('blockedTitle')}
                </p>
                <p>{t('blockedIntro')}</p>
                <ul className="list-disc space-y-1 pl-5">
                  {preview.blocked.map((b, i) => (
                    <li key={i}>
                      {t(`blocked.${b.kind}`)} : <span className="font-mono">{b.match}</span>
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-900">
                <Segments segments={preview.title} />
              </p>
              {preview.objective.length ? (
                <p className="text-slate-700">
                  <Segments segments={preview.objective} />
                </p>
              ) : null}
              <p className="whitespace-pre-wrap text-slate-800">
                <Segments segments={preview.text} />
              </p>
            </div>
            <p className="text-sm font-medium text-slate-700">
              {t('replacedCount', { count: preview.replaced })}
            </p>
            <p className="text-sm text-slate-600">{t('previewCheck')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void send.run(form())}
                disabled={send.pending || preview.blocked.length > 0 || aiOff}
              >
                {send.pending ? t('sending') : t('send')}
              </Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                {t('editText')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
