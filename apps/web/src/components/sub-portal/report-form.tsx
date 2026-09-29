'use client';

import { subReportOutcomes, type ReportableLesson, type SubReportOutcome } from '@lynx/domain';
import { ArrowLeft, CloudOff, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { RosterStudent } from '@/components/sub-plans/types';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field, Textarea } from '@/components/ui/field';
import { useErrorText } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { useOnline } from '@/hooks/use-online';
import type { ActionResult } from '@/lib/action-result';
import { formatInstantTime, formatTimeRange } from '@/lib/format';
import {
  saveSubReport,
  submitSubReport,
  type SubReportSaveResult,
} from '@/server/actions/sub-portal';
import { reportFromState, type ReportFormState } from './report-state';

/** The tab copy of the report: kept for this tab only, cleared once sent (D-054). */
export const reportDraftKey = (planId: string) => `sub-report:${planId}`;

/** The autosave waits this long after the last change. */
const AUTOSAVE_MS = 3000;
/** « Envoyer le suivi » is tried again after a lost connection, with these waits. */
const SUBMIT_RETRIES_MS = [1000, 2000, 4000];

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  /** `key`: why (a translation key under `errors`). */
  | { kind: 'error'; key: string };

/** Errors that go away by themselves: the autosave tries again (with growing waits). */
const TRANSIENT = new Set(['network', 'unexpected']);
type Phase = 'editing' | 'locked' | 'confirmed' | 'notReleased';

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export interface ReportFormProps {
  planId: string;
  /** The plan version the page shows (saves then skip reloading the plan). */
  contentVersion: number;
  timeZone: string;
  lessons: ReportableLesson[];
  /** Covered classes, to group the absent-student chips when there are several. */
  classes: { classId: string; name: string }[];
  roster: RosterStudent[];
  /** What the server holds (or the defaults). */
  initial: ReportFormState;
  /** The report's status on the server. */
  status: 'none' | 'draft' | 'submitted' | 'confirmed';
  /** When the server last saved it. */
  updatedAt: string | null;
  lockedToOtherDevice: boolean;
  /** The saved notes could not be decrypted (they are shown empty). */
  notesUnreadable: boolean;
}

/**
 * « Suivi de la journée », filled in during the day on the substitute's phone: one outcome per
 * lesson (« Terminé / En partie / Pas fait ») with a note, the absent students (for information),
 * behaviour and notes for the teacher. Saved to the server 3 s after the last change and kept in
 * this tab meanwhile, so a lost connection or a closed page never loses it. The report belongs to
 * the device that started it. « Envoyer le suivi » is retried after a lost connection.
 */
export function ReportForm({
  planId,
  contentVersion,
  timeZone,
  lessons,
  classes,
  roster,
  initial,
  status,
  updatedAt,
  lockedToOtherDevice,
  notesUnreadable,
}: ReportFormProps) {
  const t = useTranslations('subReport');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const online = useOnline();
  const errorText = useErrorText();
  const id = useId();

  const draft = useDraft(reportDraftKey(planId), initial, { storage: 'session' });
  const { clear: clearDraft, setValue: setDraftValue } = draft;
  const [phase, setPhase] = useState<Phase>(
    status === 'confirmed' ? 'confirmed' : lockedToOtherDevice ? 'locked' : 'editing',
  );
  const [sentAt, setSentAt] = useState<string | null>(
    status === 'submitted' ? (updatedAt ?? null) : null,
  );
  const [saveState, setSaveState] = useState<SaveState>(
    status === 'draft' && updatedAt ? { kind: 'saved', at: updatedAt } : { kind: 'idle' },
  );
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const rosterIds = useMemo(() => new Set(roster.map((s) => s.id)), [roster]);
  const multipleClasses = classes.length > 1;

  // The latest form, for saves that run after a delay.
  const value = useRef(draft.value);
  useEffect(() => {
    value.current = draft.value;
  }, [draft.value]);
  // Changes the server does not have yet (a draft restored from this tab counts): the ref for
  // saves on their way, the state for the page.
  const unsaved = useRef(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const markUnsaved = useCallback((on: boolean) => {
    unsaved.current = on;
    setHasUnsaved(on);
  }, []);
  const inFlight = useRef<Promise<unknown> | null>(null);
  // Autosaves that failed in a row: each retry waits twice as long (at most a minute).
  const failures = useRef(0);
  const [saveTick, setSaveTick] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a restored draft goes to the server
    if (draft.restored) markUnsaved(true);
  }, [draft.restored, markUnsaved]);

  const edit = useCallback(
    (update: (prev: ReportFormState) => ReportFormState) => {
      markUnsaved(true);
      setDraftValue(update);
    },
    [markUnsaved, setDraftValue],
  );

  const payload = useCallback(
    () => ({
      ...reportFromState(value.current, lessons, rosterIds),
      knownVersion: contentVersion,
    }),
    [lessons, rosterIds, contentVersion],
  );

  /** What every save answered, except « sent », which each caller handles. */
  const settle = useCallback(
    (result: SubReportSaveResult) => {
      switch (result.status) {
        case 'saved':
          setSaveState({ kind: 'saved', at: result.updatedAt });
          return;
        case 'submitted':
          return;
        case 'expired':
          clearDraft();
          router.replace('/suppleance?ended=1');
          return;
        case 'notReleased':
          setPhase('notReleased');
          return;
        case 'lockedOtherDevice':
          setPhase('locked');
          return;
        case 'confirmed':
          clearDraft();
          markUnsaved(false);
          setPhase('confirmed');
          return;
        case 'alreadySubmitted':
          // Sent from another tab of this device: nothing was written, so the changes wait for
          // « Renvoyer le suivi » (the page says so; the autosave stops once it is sent).
          setSentAt((at) => at ?? new Date().toISOString());
          setSaveState({ kind: 'idle' });
          markUnsaved(true);
          return;
      }
    },
    [clearDraft, markUnsaved, router],
  );

  const autosave = useCallback(async () => {
    if (inFlight.current) await inFlight.current;
    if (!unsaved.current || phase !== 'editing' || sentAt) return;
    markUnsaved(false);
    setSaveState({ kind: 'saving' });
    const sent = value.current;
    const run = saveSubReport(payload())
      .then((result: ActionResult<SubReportSaveResult>) => {
        if (result.ok) {
          failures.current = 0;
          setFieldErrors({});
          settle(result.data);
          // The server has exactly what the tab holds: the tab copy is no longer needed (and a
          // reload shows the server's report, not a « draft restored » notice).
          if (result.data.status === 'saved' && !unsaved.current && value.current === sent) {
            clearDraft();
          }
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSaveState({ kind: 'error', key: result.error });
        if (TRANSIENT.has(result.error)) {
          failures.current += 1;
          markUnsaved(true);
        } else {
          // Saving again would fail the same way: wait for the next change (the changes stay
          // in this tab, and « Envoyer le suivi » sends them).
          unsaved.current = true;
        }
      })
      .catch(() => {
        failures.current += 1;
        markUnsaved(true);
        setSaveState({ kind: 'error', key: 'network' });
      });
    inFlight.current = run;
    await run;
    inFlight.current = null;
    // Changes made while this save was on its way go in the next one.
    if (unsaved.current) setSaveTick((n) => n + 1);
  }, [clearDraft, markUnsaved, payload, phase, sentAt, settle]);

  useEffect(() => {
    // Offline, the tab keeps the changes until the connection is back.
    if (!hasUnsaved || phase !== 'editing' || sentAt || submitting || !online) return;
    const delay = Math.min(AUTOSAVE_MS * 2 ** failures.current, 60_000);
    const timer = window.setTimeout(() => void autosave(), delay);
    return () => window.clearTimeout(timer);
  }, [draft.value, hasUnsaved, saveTick, phase, sentAt, submitting, online, autosave]);

  const submit = async () => {
    setSubmitting(true);
    try {
      if (inFlight.current) await inFlight.current;
      for (let attempt = 0; ; attempt++) {
        let result: ActionResult<SubReportSaveResult>;
        try {
          result = await submitSubReport(payload());
        } catch {
          if (attempt >= SUBMIT_RETRIES_MS.length) {
            toast.error(errorText('network'));
            return;
          }
          await wait(SUBMIT_RETRIES_MS[attempt]!);
          continue;
        }
        if (!result.ok) {
          setFieldErrors(result.fieldErrors ?? {});
          toast.error(errorText(result.error));
          return;
        }
        if (result.data.status === 'submitted') {
          markUnsaved(false);
          clearDraft();
          router.push('/suppleance/done');
          return;
        }
        settle(result.data);
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };

  const back = (
    <Link
      href="/suppleance/plan"
      className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t('backToPlan')}
    </Link>
  );

  if (phase !== 'editing') {
    return (
      <div className="space-y-4">
        {back}
        <Notice tone={phase === 'confirmed' ? 'success' : 'warning'}>
          {phase === 'confirmed'
            ? t('alreadyConfirmed')
            : phase === 'locked'
              ? t('lockedOtherDevice')
              : t('notReleased')}
        </Notice>
      </div>
    );
  }

  const v = draft.value;
  const fieldError = (path: string) => errorText(fieldErrors[path]) ?? undefined;
  const setOutcome = (lessonId: string, outcome: SubReportOutcome) =>
    edit((prev) => ({ ...prev, outcomes: { ...prev.outcomes, [lessonId]: outcome } }));
  const setLessonNote = (blockKey: string, text: string) =>
    edit((prev) => ({ ...prev, lessonNotes: { ...prev.lessonNotes, [blockKey]: text } }));
  const toggleAbsent = (studentId: string) =>
    edit((prev) => ({
      ...prev,
      absent: prev.absent.includes(studentId)
        ? prev.absent.filter((s) => s !== studentId)
        : [...prev.absent, studentId],
    }));
  const rosterByClass = classes
    .map((c) => ({ ...c, students: roster.filter((s) => s.classId === c.classId) }))
    .filter((c) => c.students.length > 0);

  const saveText =
    sentAt && hasUnsaved
      ? t('changesToSend')
      : !online && hasUnsaved
        ? t('offline')
        : saveState.kind === 'saving'
          ? t('saving')
          : saveState.kind === 'saved'
            ? t('draftSaved', { time: formatInstantTime(saveState.at, timeZone, locale) })
            : saveState.kind === 'error'
              ? TRANSIENT.has(saveState.key)
                ? t('notSaved')
                : errorText(saveState.key)
              : null;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {back}
      {sentAt ? (
        <Notice tone="success" data-testid="report-sent">
          {t('sent', { time: formatInstantTime(sentAt, timeZone, locale) })}
        </Notice>
      ) : (
        <p className="text-slate-700">{t('intro')}</p>
      )}
      {draft.restored ? <Notice>{tCommon('draftRestored')}</Notice> : null}
      {notesUnreadable ? <Notice tone="warning">{t('notesUnreadable')}</Notice> : null}

      <section aria-labelledby={`${id}-lessons`} className="space-y-3">
        <h2 id={`${id}-lessons`} className="text-lg font-semibold text-slate-900">
          {t('lessonsTitle')}
        </h2>
        {lessons.length === 0 ? <p className="text-sm text-slate-600">{t('noLessons')}</p> : null}
        <ol className="space-y-3">
          {lessons.map((lesson) => {
            const headingId = `${id}-lesson-${lesson.lessonId}`;
            return (
              <li
                key={lesson.lessonId}
                data-testid="report-lesson"
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div id={headingId}>
                  <p className="text-sm text-slate-600 tabular-nums">
                    {[
                      formatTimeRange(lesson.start, lesson.end, locale),
                      multipleClasses ? lesson.className : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <h3 className="font-semibold text-slate-900">
                    {t('lessonLine', { n: lesson.sequenceNumber, title: lesson.title })}
                  </h3>
                  <p className="text-sm text-slate-600">{lesson.unitTitle}</p>
                </div>
                <div role="radiogroup" aria-labelledby={headingId} className="flex flex-wrap gap-2">
                  {subReportOutcomes.map((outcome) => (
                    <Chip
                      key={outcome}
                      name={`${id}-outcome-${lesson.lessonId}`}
                      value={outcome}
                      checked={v.outcomes[lesson.lessonId] === outcome}
                      onChange={() => setOutcome(lesson.lessonId, outcome)}
                    >
                      {t(`outcome.${outcome}`)}
                    </Chip>
                  ))}
                </div>
                <Field
                  label={t('lessonNote')}
                  htmlFor={`${id}-note-${lesson.blockKey}`}
                  error={fieldError(`notes.lessonNotes.${lesson.blockKey}`)}
                >
                  <Textarea
                    id={`${id}-note-${lesson.blockKey}`}
                    className="min-h-16"
                    maxLength={1000}
                    value={v.lessonNotes[lesson.blockKey] ?? ''}
                    onChange={(e) => setLessonNote(lesson.blockKey, e.target.value)}
                  />
                </Field>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby={`${id}-absent`} className="space-y-3">
        <div>
          <h2 id={`${id}-absent`} className="text-lg font-semibold text-slate-900">
            {t('absent')}
          </h2>
          <p className="text-sm text-slate-600">{t('absentHint')}</p>
        </div>
        {rosterByClass.map((c) => (
          <div
            key={c.classId}
            role="group"
            aria-label={multipleClasses ? c.name : t('absent')}
            className="space-y-2"
          >
            {multipleClasses ? (
              <p className="text-sm font-medium text-slate-700">{c.name}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {c.students.map((s) => (
                <Chip
                  key={s.id}
                  type="checkbox"
                  name={`${id}-absent`}
                  value={s.id}
                  checked={v.absent.includes(s.id)}
                  onChange={() => toggleAbsent(s.id)}
                >
                  {s.firstName}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </section>

      <Field
        label={<span className="text-lg font-semibold text-slate-900">{t('behaviour')}</span>}
        htmlFor={`${id}-behaviour`}
        hint={t('behaviourHint')}
        error={fieldError('notes.behaviour')}
      >
        <Textarea
          id={`${id}-behaviour`}
          maxLength={3000}
          value={v.behaviour}
          onChange={(e) => edit((prev) => ({ ...prev, behaviour: e.target.value }))}
        />
      </Field>

      <Field
        label={<span className="text-lg font-semibold text-slate-900">{t('notes')}</span>}
        htmlFor={`${id}-for-teacher`}
        hint={t('notesHint')}
        error={fieldError('notes.forTeacher')}
      >
        <Textarea
          id={`${id}-for-teacher`}
          maxLength={3000}
          value={v.forTeacher}
          onChange={(e) => edit((prev) => ({ ...prev, forTeacher: e.target.value }))}
        />
      </Field>

      <div className="sticky bottom-0 z-20 -mx-4 space-y-2 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:mx-0 md:rounded-xl md:border">
        <p
          className="flex min-h-5 items-center gap-1.5 text-sm text-slate-600"
          role="status"
          aria-live="polite"
          data-testid="report-save-state"
        >
          {!online ? <CloudOff className="size-4" aria-hidden /> : null}
          {saveText}
        </p>
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          <Send aria-hidden />
          {submitting ? t('submitting') : sentAt ? t('resubmit') : t('submit')}
        </Button>
      </div>
    </form>
  );
}
