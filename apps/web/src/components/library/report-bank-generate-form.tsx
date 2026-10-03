'use client';

import { FIRST_NAME_TOKEN } from '@lynx/content';
import { ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { listGenerationExpectations, type ExpectationGroup } from '@/server/actions/library-ai';
import {
  previewReportBankGeneration,
  requestReportBankGeneration,
  type ReportBankPreview,
} from '@/server/actions/report-bank-ai';
import type { LibraryJobStatus } from '@/server/queries/library-ai';
import type { ReportBankFormContext, ReportBankFormValues } from '@/server/queries/report-bank-ai';
import { BlockedDetails, SentText } from './generate-preview';
import {
  BANK_LENGTHS,
  BANK_MAX_EXPECTATIONS,
  BANK_NOTE_MAX,
  BANK_PERIODS,
  BANK_SCOPES,
  bankSubjects,
  effectiveBankValues,
  toBankForm,
} from './report-bank-values';

const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';

type Expectations =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; groups: ExpectationGroup[] };

/**
 * « Créer une banque avec l’IA » (DECISIONS D-132): the teacher chooses what the bank is for (a
 * subject, the learning skills and work habits, or Enseignement religieux), one grade, the
 * subject, the report, up to 12 attentes and the length of the entries, then checks exactly what
 * would be sent before sending it. Nothing about her students is part of the request. Her
 * choices are kept on the device (D-035) until the request succeeds; one that failed brings them
 * back.
 */
export function ReportBankGenerateForm({
  context,
  initial,
  draftKey,
  jobStatuses,
  resumed,
}: {
  context: ReportBankFormContext;
  initial: ReportBankFormValues;
  /** Under `reportBankDraftPrefix(userId)`. */
  draftKey: string;
  /** Status of the recent requests, to know what became of a draft that was sent. */
  jobStatuses: Record<string, LibraryJobStatus>;
  /** The form starts from an earlier request (« Reprendre la demande »). */
  resumed: boolean;
}) {
  const t = useTranslations('reportBankAi');
  const tAi = useTranslations('libraryAi');
  const tc = useTranslations('libraryCommon');
  const tCommon = useTranslations('common');
  const tNews = useTranslations('newsletter.ai');
  const locale = useLocale();
  const router = useRouter();
  const draft = useDraft(draftKey, initial, {
    sentPolicy: (jobId) => {
      const status = jobStatuses[jobId];
      return status === 'failed' ? 'restore' : status === 'succeeded' ? 'drop' : 'keep';
    },
  });
  const v = effectiveBankValues(draft.value, context);
  const school = context.schools.find((s) => s.id === v.schoolId);
  const aiOff = !school?.aiEnabled;
  const skills = v.scope === 'learning_skills';
  const [preview, setPreview] = useState<ReportBankPreview | null>(null);
  // « J'ai vérifié », for the preview shown (a new preview asks again).
  const [checked, setChecked] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; result: Expectations } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const subjects = bankSubjects(context, v);
  const subject = subjects.find((s) => s.id === v.subjectId) ?? null;

  const expectationsKey =
    !skills && v.subjectId && v.gradeCode ? `${v.gradeCode}|${v.subjectId}` : null;
  useEffect(() => {
    if (!expectationsKey) return;
    let current = true;
    const [grade = '', subjectId = ''] = expectationsKey.split('|');
    listGenerationExpectations([grade], subjectId)
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

  const check = useAction(previewReportBankGeneration, {
    onSuccess: (data) => {
      setPreview(data);
      setChecked(false);
    },
  });
  const send = useAction(requestReportBankGeneration, {
    onSuccess: ({ jobId }) => {
      // Not cleared yet: if the request fails, the teacher gets her choices back (D-035).
      draft.markSent(jobId, v);
      router.push(`/library/generate/${jobId}`);
    },
  });
  const fieldError = (name: string) => check.fieldError(name) ?? send.fieldError(name);

  // Any change invalidates the preview: what is sent must be what was checked.
  const update = (changes: Partial<ReportBankFormValues>) => {
    setPreview(null);
    draft.setValue((prev) => ({ ...effectiveBankValues(prev, context), ...changes }));
  };
  const toggleExpectation = (id: string, on: boolean) =>
    update({
      expectationIds: on ? [...v.expectationIds, id] : v.expectationIds.filter((e) => e !== id),
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void check.run(toBankForm(v));
  };

  return (
    <div className="space-y-4">
      {draft.restored ? (
        <Notice tone="info" className="flex flex-wrap items-center justify-between gap-2">
          <span>{draft.sentAs ? tAi('failedDraftRestored') : tCommon('draftRestored')}</span>
          <Button variant="ghost" onClick={() => draft.discard()}>
            {tCommon('discardDraft')}
          </Button>
        </Notice>
      ) : null}
      {resumed && !draft.restored ? <Notice tone="info">{tAi('resumed')}</Notice> : null}
      {school?.boardOff ? <Notice tone="warning">{tAi('aiBoardOff')}</Notice> : null}
      {school && aiOff && !school.boardOff ? <Notice tone="warning">{tAi('aiOff')}</Notice> : null}

      <Card>
        <CardBody className="pt-4">
          <form onSubmit={submit} className="space-y-5" noValidate>
            {context.schools.length > 1 ? (
              <Field label={t('fields.school')} htmlFor="bank-school">
                <Select
                  id="bank-school"
                  value={v.schoolId}
                  onChange={(e) => update({ schoolId: e.target.value })}
                >
                  {context.schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">{t('fields.scope')}</legend>
              <div className="flex flex-wrap gap-2">
                {BANK_SCOPES.map((scope) => (
                  <label key={scope} className={chip}>
                    <input
                      type="radio"
                      name="bank-scope"
                      className="size-4 accent-brand-600"
                      checked={v.scope === scope}
                      onChange={() => update({ scope, expectationIds: [] })}
                    />
                    <span>{tc(`reportBankScopes.${scope}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.grade')} htmlFor="bank-grade" error={fieldError('gradeCode')}>
                <Select
                  id="bank-grade"
                  value={v.gradeCode}
                  onChange={(e) => update({ gradeCode: e.target.value, expectationIds: [] })}
                >
                  <option value="">{t('fields.gradePlaceholder')}</option>
                  {context.grades.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </Field>

              {v.scope === 'subject' ? (
                <Field
                  label={t('fields.subject')}
                  htmlFor="bank-subject"
                  error={fieldError('subjectId')}
                >
                  <Select
                    id="bank-subject"
                    value={v.subjectId}
                    disabled={!v.gradeCode}
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
              ) : v.scope === 'religion' ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-slate-700">{t('fields.subject')}</p>
                  <p className="flex min-h-11 items-center text-slate-900">
                    {subject?.label ?? t('fields.subjectMissing')}
                  </p>
                </div>
              ) : null}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">{t('fields.period')}</legend>
              <div className="flex flex-wrap gap-2">
                {BANK_PERIODS.map((period) => (
                  <label key={period} className={chip}>
                    <input
                      type="radio"
                      name="bank-period"
                      className="size-4 accent-brand-600"
                      checked={v.period === period}
                      onChange={() => update({ period })}
                    />
                    <span>{t(`fields.periods.${period}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {skills ? (
              <p className="text-sm text-slate-600">{t('fields.skillsHint')}</p>
            ) : (
              <fieldset className="space-y-2" aria-describedby="bank-exp-hint">
                <legend className="text-sm font-medium text-slate-700">
                  {t('fields.expectations', { max: BANK_MAX_EXPECTATIONS })}
                </legend>
                <p id="bank-exp-hint" className="text-sm text-slate-500">
                  {t('fields.expectationsHint')}
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
                    <span>{tAi('fields.expectationsError')}</span>
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
                  <Notice tone="info">{t('fields.expectationsEmpty')}</Notice>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600" aria-live="polite">
                      {t('fields.expectationsCount', {
                        count: v.expectationIds.length,
                        max: BANK_MAX_EXPECTATIONS,
                      })}
                    </p>
                    {expectations.groups.map((group) => (
                      <div key={group.strandId ?? 'none'} className="space-y-1">
                        {group.strandLabel ? (
                          <p className="text-sm font-semibold text-slate-800">
                            {group.strandLabel}
                          </p>
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
                                    disabled={
                                      !checked && v.expectationIds.length >= BANK_MAX_EXPECTATIONS
                                    }
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
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">{t('fields.length')}</legend>
              <div className="flex flex-wrap gap-2">
                {BANK_LENGTHS.map((length) => (
                  <label key={length} className={chip}>
                    <input
                      type="radio"
                      name="bank-length"
                      className="size-4 accent-brand-600"
                      checked={v.length === length}
                      onChange={() => update({ length })}
                    />
                    <span>{t(`fields.lengths.${length}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Field
              label={
                <>
                  {t('fields.note')}{' '}
                  <span className="font-normal text-slate-500">({tCommon('optional')})</span>
                </>
              }
              htmlFor="bank-note"
              hint={t('fields.noteHint', { max: BANK_NOTE_MAX })}
              error={fieldError('teacherNote')}
            >
              <Textarea
                id="bank-note"
                value={v.teacherNote}
                maxLength={BANK_NOTE_MAX}
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
        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>{t('previewTitle')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Notice tone="info" className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="font-medium">
                {preview.note ? t('previewNoStudents') : t('previewNoStudentsNoNote')}
              </span>
            </Notice>
            <p className="text-sm text-slate-600">
              {t('previewIntro', { token: FIRST_NAME_TOKEN })}
            </p>
            <BlockedDetails blocked={preview.blocked} />
            <SentText segments={preview.message} />
            <p className="text-sm font-medium text-slate-700">
              {tAi('replacedCount', { count: preview.replaced })}
            </p>
            {preview.note && !preview.blocked.length ? (
              <>
                <Notice
                  tone={preview.words.length ? 'warning' : 'info'}
                  data-testid="bank-note-words"
                >
                  <p>
                    {preview.words.length
                      ? tNews('words', {
                          words: new Intl.ListFormat(locale, { type: 'unit' }).format(
                            preview.words,
                          ),
                        })
                      : tNews('noWords')}
                  </p>
                  <p className="mt-1 text-sm">{t('noteLimit')}</p>
                </Notice>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 bg-white p-3 text-slate-900">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0 accent-brand-600"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  <span>{t('noteConfirm')}</span>
                </label>
              </>
            ) : (
              <p className="text-sm text-slate-600">{t('previewCheck')}</p>
            )}
            <p className="text-sm text-slate-600">{t('reviewNote')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void send.run(toBankForm(v), checked)}
                disabled={
                  send.pending || preview.blocked.length > 0 || aiOff || (preview.note && !checked)
                }
              >
                {send.pending ? tAi('sending') : tAi('send')}
              </Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                {tAi('edit')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
