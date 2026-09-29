'use client';

import { LIBRARY_BUCKETS, TYPE_INFO, typesOf, type LibraryItemType } from '@lynx/content';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, Notice } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import {
  listGenerationExpectations,
  previewLibraryGeneration,
  requestLibraryGeneration,
  type ExpectationGroup,
  type GenerationPreview,
} from '@/server/actions/library-ai';
import type {
  GenerateFormContext,
  GenerateFormValues,
  LibraryJobStatus,
} from '@/server/queries/library-ai';
import { GeneratePreview } from './generate-preview';
import {
  chosenReferenceId,
  DURATION_CHOICES,
  effectiveGenerateValues,
  levelsForSchool,
  MAX_EXPECTATIONS,
  MAX_GRADES,
  referenceChoices,
  subjectsForGrades,
  toGenerateForm,
} from './generate-values';

const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';

type Expectations =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; groups: ExpectationGroup[] };

/**
 * « Créer avec l’IA » (DECISIONS D-072, D-074): the teacher chooses the type, the grade, the
 * subject, one to five attentes, the duration, versions per level and, if she wants, a link with
 * the faith, then checks exactly what would be sent before sending it. Her choices are kept on
 * the device (D-035) until the request succeeds; a request that failed brings them back.
 */
export function GenerateForm({
  context,
  initial,
  draftKey,
  jobStatuses,
  resumed,
}: {
  context: GenerateFormContext;
  initial: GenerateFormValues;
  /** Under `generateDraftPrefix(userId)`. */
  draftKey: string;
  /** Status of the recent requests, to know what became of a draft that was sent. */
  jobStatuses: Record<string, LibraryJobStatus>;
  /** The form starts from an earlier request (« Reprendre la demande »). */
  resumed: boolean;
}) {
  const t = useTranslations('libraryAi');
  const tc = useTranslations('libraryCommon');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const draft = useDraft(draftKey, initial, {
    // A sent draft is kept until its request succeeds; it comes back only if it failed.
    sentPolicy: (jobId) => {
      const status = jobStatuses[jobId];
      return status === 'failed' ? 'restore' : status === 'succeeded' ? 'drop' : 'keep';
    },
  });
  const v = effectiveGenerateValues(draft.value, context);
  const info = TYPE_INFO[v.itemType];
  const school = context.schools.find((s) => s.id === v.schoolId);
  const aiOff = !school?.aiEnabled;
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  // The attentes of the chosen grades and subject, from the curriculum, by request.
  const [loaded, setLoaded] = useState<{ key: string; result: Expectations } | null>(null);
  // « Réessayer » after a failed load asks again for the same grades and subject.
  const [attempt, setAttempt] = useState(0);

  const subjects = subjectsForGrades(context, v.gradeCodes);
  const subject = subjects.find((s) => s.id === v.subjectId) ?? null;
  const levels = levelsForSchool(context, v.schoolId);

  const gradesKey = v.gradeCodes.join(',');
  const expectationsKey = v.subjectId && gradesKey ? `${gradesKey}|${v.subjectId}` : null;
  useEffect(() => {
    if (!expectationsKey) return;
    let current = true;
    const [grades = '', subjectId = ''] = expectationsKey.split('|');
    listGenerationExpectations(grades.split(','), subjectId)
      .then((result) => {
        if (!current) return;
        setLoaded({
          key: expectationsKey,
          result: result.ok ? { state: 'ready', groups: result.data } : { state: 'error' },
        });
      })
      .catch(() => {
        if (current) setLoaded({ key: expectationsKey, result: { state: 'error' } });
      });
    return () => {
      current = false;
    };
  }, [expectationsKey, attempt]);
  const expectations: Expectations = !expectationsKey
    ? { state: 'idle' }
    : loaded?.key === expectationsKey
      ? loaded.result
      : { state: 'loading' };

  const expectationTexts =
    expectations.state === 'ready'
      ? expectations.groups
          .flatMap((g) => g.expectations)
          .filter((e) => v.expectationIds.includes(e.id))
          .map((e) => e.text)
      : [];
  const references = referenceChoices(context, v, {
    subject: subject?.label ?? null,
    expectations: expectationTexts,
  });
  const referenceId = chosenReferenceId(v, references);
  const form = () => toGenerateForm(v, referenceId);

  const check = useAction(previewLibraryGeneration, { onSuccess: setPreview });
  const send = useAction(requestLibraryGeneration, {
    onSuccess: ({ jobId }) => {
      // Not cleared yet: if the request fails, the teacher gets her choices back (D-035).
      draft.markSent(jobId, { ...v, catholicReferenceId: referenceId });
      router.push(`/library/generate/${jobId}`);
    },
  });
  const fieldError = (name: string) => check.fieldError(name) ?? send.fieldError(name);

  // Any change invalidates the preview: what is sent must be what was checked.
  const update = (changes: Partial<GenerateFormValues>) => {
    setPreview(null);
    draft.setValue((prev) => ({ ...effectiveGenerateValues(prev, context), ...changes }));
  };

  const toggleGrade = (code: string, on: boolean) =>
    update({
      gradeCodes: on
        ? [...v.gradeCodes, code].slice(-MAX_GRADES)
        : v.gradeCodes.filter((g) => g !== code),
      expectationIds: [],
    });
  const toggleExpectation = (id: string, on: boolean) =>
    update({
      expectationIds: on ? [...v.expectationIds, id] : v.expectationIds.filter((e) => e !== id),
    });
  const toggleLevel = (id: string, on: boolean) =>
    update({ levelIds: on ? [...v.levelIds, id] : v.levelIds.filter((l) => l !== id) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void check.run(form());
  };

  const typeOptions = LIBRARY_BUCKETS.map((bucket) => ({ bucket, types: typesOf(bucket) }));
  const suggested = references.references.slice(0, references.suggested);
  const others = references.references.slice(references.suggested);

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
      {resumed && !draft.restored ? <Notice tone="info">{t('resumed')}</Notice> : null}
      {school?.boardOff ? <Notice tone="warning">{t('aiBoardOff')}</Notice> : null}
      {school && aiOff && !school.boardOff ? <Notice tone="warning">{t('aiOff')}</Notice> : null}

      <Card>
        <CardBody className="pt-4">
          <form onSubmit={submit} className="space-y-5" noValidate>
            {context.schools.length > 1 ? (
              <Field label={t('fields.school')} htmlFor="gen-school">
                <Select
                  id="gen-school"
                  value={v.schoolId}
                  onChange={(e) => update({ schoolId: e.target.value, levelIds: [] })}
                >
                  {context.schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field
              label={t('fields.type')}
              htmlFor="gen-type"
              hint={tc(`typeHints.${v.itemType}` as 'typeHints.quiz')}
            >
              <Select
                id="gen-type"
                value={v.itemType}
                onChange={(e) => {
                  const itemType = e.target.value as LibraryItemType;
                  update({
                    itemType,
                    durationMinutes: DURATION_CHOICES.includes(TYPE_INFO[itemType].defaultDuration)
                      ? TYPE_INFO[itemType].defaultDuration
                      : v.durationMinutes,
                    withLevels: TYPE_INFO[itemType].levelable,
                    levelIds: v.levelIds.length
                      ? v.levelIds
                      : levels.filter((l) => !l.personal).map((l) => l.id),
                  });
                }}
              >
                {typeOptions.map(({ bucket, types }) => (
                  <optgroup key={bucket} label={tc(`buckets.${bucket}` as 'buckets.enseigner')}>
                    {types.map((type) => (
                      <option key={type} value={type}>
                        {tc(`types.${type}` as 'types.quiz')}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">{t('fields.grades')}</legend>
              <p className="text-sm text-slate-500">{t('fields.gradesHint')}</p>
              <div className="flex flex-wrap gap-2">
                {context.grades.map((g) => (
                  <label key={g.code} className={chip}>
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      checked={v.gradeCodes.includes(g.code)}
                      onChange={(e) => toggleGrade(g.code, e.target.checked)}
                    />
                    <span>{g.label}</span>
                  </label>
                ))}
              </div>
              {fieldError('gradeCodes') ? (
                <p className="text-sm text-red-600" role="alert">
                  {fieldError('gradeCodes')}
                </p>
              ) : null}
            </fieldset>

            <Field
              label={t('fields.subject')}
              htmlFor="gen-subject"
              error={fieldError('subjectId')}
            >
              <Select
                id="gen-subject"
                value={v.subjectId}
                disabled={!v.gradeCodes.length}
                onChange={(e) => update({ subjectId: e.target.value, expectationIds: [] })}
              >
                <option value="">{t('fields.subjectPlaceholder')}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="space-y-2" aria-describedby="gen-exp-hint">
              <legend className="text-sm font-medium text-slate-700">
                {t('fields.expectations')}
              </legend>
              <p id="gen-exp-hint" className="text-sm text-slate-500">
                {info.expectationsOptional
                  ? t('fields.expectationsOptional')
                  : t('fields.expectationsHint', { max: MAX_EXPECTATIONS })}
              </p>
              {expectations.state === 'idle' ? (
                <p className="text-sm text-slate-600">{t('fields.expectationsChooseFirst')}</p>
              ) : expectations.state === 'loading' ? (
                <p className="text-sm text-slate-600" role="status">
                  {tCommon('loading')}
                </p>
              ) : expectations.state === 'error' ? (
                <Notice
                  tone="warning"
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>{t('fields.expectationsError')}</span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setLoaded(null);
                      setAttempt((a) => a + 1);
                    }}
                  >
                    {tCommon('retry')}
                  </Button>
                </Notice>
              ) : expectations.groups.length === 0 ? (
                <p className="text-sm text-slate-600">{t('fields.expectationsEmpty')}</p>
              ) : (
                <div className="space-y-3">
                  {expectations.groups.map((group) => (
                    <div key={group.strandId ?? 'none'} className="space-y-1">
                      {group.strandLabel ? (
                        <p className="text-sm font-semibold text-slate-800">{group.strandLabel}</p>
                      ) : null}
                      <ul className="space-y-1">
                        {group.expectations.map((e) => {
                          const checked = v.expectationIds.includes(e.id);
                          return (
                            <li key={e.id}>
                              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                                <input
                                  type="checkbox"
                                  className="mt-1 size-4 shrink-0 accent-brand-600"
                                  checked={checked}
                                  disabled={!checked && v.expectationIds.length >= MAX_EXPECTATIONS}
                                  onChange={(ev) => toggleExpectation(e.id, ev.target.checked)}
                                />
                                <span className="text-sm text-slate-800">
                                  <span className="font-semibold">{e.code}</span>{' '}
                                  {e.kind === 'specific' ? null : (
                                    <span className="text-xs text-slate-600">
                                      ({tc('expectationKinds.overall')}){' '}
                                    </span>
                                  )}
                                  {e.text}{' '}
                                  {e.verified ? null : (
                                    <Badge tone="warning">{tc('badges.toVerify')}</Badge>
                                  )}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {fieldError('expectationIds') ? (
                <p className="text-sm text-red-600" role="alert">
                  {fieldError('expectationIds')}
                </p>
              ) : null}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.duration')} htmlFor="gen-duration">
                <Select
                  id="gen-duration"
                  value={String(v.durationMinutes)}
                  onChange={(e) => update({ durationMinutes: Number(e.target.value) })}
                >
                  {DURATION_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      {t('fields.minutes', { count: m })}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="space-y-1.5">
                <label className={chip}>
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={v.subFriendly}
                    disabled={!info.subFriendlyAllowed}
                    onChange={(e) => update({ subFriendly: e.target.checked })}
                  />
                  <span>{t('fields.subFriendly')}</span>
                </label>
                <p className="text-sm text-slate-500">
                  {!info.subFriendlyAllowed
                    ? t('fields.subFriendlyNever')
                    : info.needsSafety
                      ? t('fields.subFriendlyStandard')
                      : t('fields.subFriendlyHint')}
                </p>
              </div>
            </div>

            {info.levelable ? (
              <fieldset className="space-y-2">
                <legend className="sr-only">{t('fields.levels')}</legend>
                <label className={chip}>
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={v.withLevels}
                    onChange={(e) => update({ withLevels: e.target.checked })}
                  />
                  <span>{t('fields.withLevels')}</span>
                </label>
                <p className="text-sm text-slate-500">{t('fields.withLevelsHint')}</p>
                {v.withLevels ? (
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label={t('fields.levels')}
                  >
                    {levels.map((l) => (
                      <label key={l.id} className={chip}>
                        <input
                          type="checkbox"
                          className="size-4 accent-brand-600"
                          checked={v.levelIds.includes(l.id)}
                          onChange={(e) => toggleLevel(l.id, e.target.checked)}
                        />
                        <span>{l.label}</span>
                        {l.personal ? (
                          <span className="text-xs text-slate-500">
                            ({t('fields.personalLevel')})
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            <fieldset className="space-y-2">
              <legend className="sr-only">{t('fields.faithGroup')}</legend>
              <label className={chip}>
                <input
                  type="checkbox"
                  className="size-4 accent-brand-600"
                  checked={v.faith}
                  disabled={v.itemType === 'catholic_reflection'}
                  onChange={(e) => update({ faith: e.target.checked })}
                />
                <span>{t('fields.faith')}</span>
              </label>
              {v.itemType === 'catholic_reflection' ? (
                <p className="text-sm text-slate-500">{t('fields.faithForced')}</p>
              ) : null}
              {v.faith ? (
                references.references.length === 0 ? (
                  <Notice tone="warning">{t('fields.referenceNone')}</Notice>
                ) : (
                  <Field
                    label={t('fields.reference')}
                    htmlFor="gen-reference"
                    hint={
                      references.suggested === 0
                        ? t('fields.referenceNone')
                        : t('fields.referenceHint')
                    }
                    error={fieldError('catholicReferenceId')}
                  >
                    <Select
                      id="gen-reference"
                      value={referenceId}
                      onChange={(e) =>
                        update({ catholicReferenceId: e.target.value, referenceChosen: true })
                      }
                    >
                      {referenceId === '' ? (
                        <option value="">{t('fields.referencePick')}</option>
                      ) : null}
                      {suggested.length ? (
                        <optgroup label={t('fields.referenceSuggested')}>
                          {suggested.map((r) => (
                            <option key={r.id} value={r.id}>
                              {t('fields.referenceOption', {
                                title: r.title,
                                type: t(`referenceTypes.${r.type}` as 'referenceTypes.virtue'),
                              })}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {others.length ? (
                        <optgroup label={t('fields.referenceOthers')}>
                          {others.map((r) => (
                            <option key={r.id} value={r.id}>
                              {t('fields.referenceOption', {
                                title: r.title,
                                type: t(`referenceTypes.${r.type}` as 'referenceTypes.virtue'),
                              })}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                  </Field>
                )
              ) : null}
            </fieldset>

            <Field
              label={
                <>
                  {t('fields.note')}{' '}
                  <span className="font-normal text-slate-500">({tCommon('optional')})</span>
                </>
              }
              htmlFor="gen-note"
              hint={t('fields.noteHint')}
              error={fieldError('teacherNote')}
            >
              <Textarea
                id="gen-note"
                value={v.teacherNote}
                maxLength={1000}
                onChange={(e) => update({ teacherNote: e.target.value })}
                spellCheck
              />
            </Field>

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
        <GeneratePreview
          preview={preview}
          longer={info.levelable && v.withLevels && v.levelIds.length > 0}
          sending={send.pending}
          disabled={aiOff}
          onSend={() => void send.run(form())}
          onEdit={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
