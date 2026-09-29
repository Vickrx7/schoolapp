'use client';

import { ABSENCE_MAX_DAYS, addDays, type AbsencePart } from '@lynx/domain';
import { CloudOff, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input, Label, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { useOnline } from '@/hooks/use-online';
import { formatLocalDate, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { previewAbsence, publishAbsence } from '@/server/actions/absences';
import type { AbsenceSummary } from '@/server/sub-plans/summary';
import { AbsenceSummaryList, capitalize } from './absence-summary';
import { absenceDates, initialChoice, type DateChoice, type DateFields } from './form-dates';
import { FAITH_COOKIE, type AbsenceFormSchool } from './types';

interface AbsenceDraft extends DateFields {
  schoolId: string;
  note: string;
  catholicConnection: boolean;
  /** Set on the first « Envoyer »: a retried tap publishes once. */
  clientRequestId: string;
}

/** A UUID for the request, also on plain-http origins where crypto.randomUUID is missing. */
function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Remembers the faith switch on this device (no names or content in it). */
function rememberFaith(on: boolean) {
  document.cookie = `${FAITH_COOKIE}=${on ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
}

/** A tap target that behaves as a radio button or a checkbox. */
function Chip({
  type = 'radio',
  name,
  checked,
  onChange,
  children,
}: {
  type?: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
        checked
          ? 'border-brand-600 bg-brand-50 text-brand-800'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

/**
 * « Signaler une absence », made for a phone at 6 a.m.: the date is preselected (today before
 * dismissal, otherwise the next school day), so « Envoyer » is the only tap needed. A live
 * summary shows what the plan will cover. The form is kept on the device until it is sent,
 * with a request id that makes a retried « Envoyer » publish once.
 */
export function AbsenceForm({
  userId,
  schools,
  faithDefault,
}: {
  userId: string;
  schools: AbsenceFormSchool[];
  faithDefault: boolean;
}) {
  const t = useTranslations('absences');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const online = useOnline();
  const first = schools[0]!;

  const initial = useMemo<AbsenceDraft>(
    () => ({
      schoolId: first.id,
      choice: initialChoice(first),
      otherDate: '',
      several: false,
      endsOn: '',
      part: 'full_day',
      note: '',
      catholicConnection: faithDefault,
      clientRequestId: '',
    }),
    [first, faithDefault],
  );
  const draft = useDraft(`absence:${userId}:new`, initial);
  const v = draft.value;
  const { clear: clearDraft } = draft;
  const school = schools.find((s) => s.id === v.schoolId) ?? first;

  // The dates the form stands for, from the chips (a restored draft may be from another day).
  const { startsOn, endsOn, part, valid } = absenceDates(v, school);
  const singleDay = endsOn === startsOn;

  const publish = useAction(publishAbsence, {
    successMessage: t('sent'),
    onSuccess: ({ absenceId }) => {
      clearDraft();
      router.push(`/absences/${absenceId}`);
    },
  });

  // ---- Live summary (debounced; stale answers are ignored) -----------------------------
  const previewKey = valid ? JSON.stringify([school.id, startsOn, endsOn, part]) : null;
  const [preview, setPreview] = useState<{
    key: string;
    result: AbsenceSummary | 'error';
  } | null>(null);
  useEffect(() => {
    if (!previewKey) return;
    const [schoolId, from, to, dayPart] = JSON.parse(previewKey) as [
      string,
      string,
      string,
      AbsencePart,
    ];
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await previewAbsence({
          schoolId,
          startsOn: from,
          endsOn: to,
          part: dayPart,
          catholicConnection: false,
        });
        if (!cancelled) setPreview({ key: previewKey, result: result.ok ? result.data : 'error' });
      } catch {
        if (!cancelled) setPreview({ key: previewKey, result: 'error' });
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewKey]);
  const summary = preview && preview.key === previewKey ? preview.result : null;
  const split =
    (summary && summary !== 'error' ? summary.days[0]?.split : null) ?? school.halfDaySplit;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || publish.pending) return;
    const clientRequestId = v.clientRequestId || newRequestId();
    if (!v.clientRequestId) draft.update('clientRequestId', clientRequestId);
    rememberFaith(v.catholicConnection);
    void publish.run({
      schoolId: school.id,
      startsOn,
      endsOn,
      part,
      note: v.note,
      catholicConnection: v.catholicConnection,
      clientRequestId,
    });
  };

  const choose = (choice: DateChoice) => {
    draft.update('choice', choice);
    // A new date is a new absence: never reuse the id of one that may have been sent.
    draft.update('clientRequestId', '');
  };
  const longDate = (date: string) =>
    capitalize(formatLocalDate(date, locale, { weekday: 'long', day: 'numeric', month: 'short' }));

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {draft.restored ? (
        <Notice className="flex flex-wrap items-center justify-between gap-2">
          <span>{tCommon('draftRestored')}</span>
          <Button variant="ghost" size="sm" onClick={draft.discard}>
            {tCommon('discardDraft')}
          </Button>
        </Notice>
      ) : null}
      {!online ? (
        <Notice tone="warning" className="flex items-center gap-2">
          <CloudOff className="size-4 shrink-0" aria-hidden />
          {t('offline')}
        </Notice>
      ) : null}

      {schools.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">{t('school')}</legend>
          <div className="flex flex-wrap gap-2">
            {schools.map((s) => (
              <Chip
                key={s.id}
                name="school"
                checked={s.id === school.id}
                onChange={() => draft.update('schoolId', s.id)}
              >
                {s.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">{t('when')}</legend>
        <div className="flex flex-wrap gap-2">
          {school.todayOpen ? (
            <Chip name="date" checked={v.choice === 'today'} onChange={() => choose('today')}>
              {t('today')}
            </Chip>
          ) : null}
          <Chip
            name="date"
            checked={v.choice === 'next' || (v.choice === 'today' && !school.todayOpen)}
            onChange={() => choose('next')}
          >
            {longDate(school.nextSchoolDay)}
          </Chip>
          <Chip name="date" checked={v.choice === 'other'} onChange={() => choose('other')}>
            {t('otherDate')}
          </Chip>
          <Chip
            type="checkbox"
            name="several"
            checked={v.several}
            onChange={() => {
              draft.update('several', !v.several);
              draft.update('clientRequestId', '');
            }}
          >
            {t('severalDays')}
          </Chip>
        </div>
        {v.choice === 'other' || v.several ? (
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            {v.choice === 'other' ? (
              <Field
                label={v.several ? t('startsOn') : t('date')}
                htmlFor="absence-start"
                error={publish.fieldError('startsOn')}
              >
                <Input
                  id="absence-start"
                  type="date"
                  min={school.today}
                  max={addDays(school.today, 60)}
                  value={v.otherDate}
                  onChange={(e) => {
                    draft.update('otherDate', e.target.value);
                    draft.update('clientRequestId', '');
                  }}
                />
              </Field>
            ) : null}
            {v.several ? (
              <Field label={t('endsOn')} htmlFor="absence-end" error={publish.fieldError('endsOn')}>
                <Input
                  id="absence-end"
                  type="date"
                  min={startsOn || school.today}
                  max={startsOn ? addDays(startsOn, ABSENCE_MAX_DAYS - 1) : undefined}
                  value={v.endsOn}
                  onChange={(e) => {
                    draft.update('endsOn', e.target.value);
                    draft.update('clientRequestId', '');
                  }}
                />
              </Field>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2" disabled={!singleDay}>
        <legend className="text-sm font-medium text-slate-700">{t('partLabel')}</legend>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {(['full_day', 'am', 'pm'] as const).map((p) => (
            <label
              key={p}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
                part === p ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600',
                !singleDay && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="part"
                className="sr-only"
                checked={part === p}
                onChange={() => {
                  draft.update('part', p);
                  draft.update('clientRequestId', '');
                }}
              />
              {t(`part.${p}`)}
            </label>
          ))}
        </div>
        {split && part !== 'full_day' ? (
          <p className="text-sm text-slate-600">
            {part === 'am'
              ? t('partHintAm', { time: formatTime(split, locale) })
              : t('partHintPm', { time: formatTime(split, locale) })}
          </p>
        ) : null}
        {publish.fieldError('part') ? (
          <p className="text-sm text-red-600" role="alert">
            {publish.fieldError('part')}
          </p>
        ) : null}
      </fieldset>

      <Field
        label={`${t('note')} (${tCommon('optional')})`}
        htmlFor="absence-note"
        hint={t('noteHint')}
        error={publish.fieldError('note')}
      >
        <Textarea
          id="absence-note"
          value={v.note}
          maxLength={1000}
          className="min-h-20"
          onChange={(e) => draft.update('note', e.target.value)}
        />
      </Field>

      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="absence-faith">{t('faith')}</Label>
          <p className="text-sm text-slate-500">{t('faithHint')}</p>
        </div>
        <input
          id="absence-faith"
          type="checkbox"
          role="switch"
          className="mt-1 size-6 shrink-0 accent-brand-600"
          checked={v.catholicConnection}
          onChange={(e) => {
            draft.update('catholicConnection', e.target.checked);
            rememberFaith(e.target.checked);
          }}
        />
      </div>

      <div
        className="rounded-xl border border-slate-200 bg-white p-3"
        role="status"
        aria-live="polite"
      >
        {!valid ? (
          <p className="text-sm text-slate-500">{t('chooseDate')}</p>
        ) : summary === null ? (
          <p className="text-sm text-slate-500">{t('summaryLoading')}</p>
        ) : summary === 'error' ? (
          <p className="text-sm text-slate-600">{t('summaryUnavailable')}</p>
        ) : (
          <AbsenceSummaryList summary={summary} />
        )}
      </div>

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-4 md:mx-0 md:rounded-xl md:border">
        <Button type="submit" size="lg" className="w-full" disabled={!valid || publish.pending}>
          <Send aria-hidden />
          {publish.pending ? t('sending') : t('send')}
        </Button>
      </div>
    </form>
  );
}
