'use client';

import type { ComposerReport, LocalDate, ReportPeriodKind } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { composerHref } from '@/server/report-comments/view-model';

export interface ComposerFilterValues {
  period: ReportPeriodKind | 'custom';
  from: LocalDate | null;
  to: LocalDate | null;
  kind: ComposerReport;
  subject: string;
  bank: string | null;
}

/**
 * « Période », « Matière » and « Banque » (DECISIONS D-130): a GET form of filters only (never a
 * comment: the comment fields sit outside every form), read back by the server, so a chosen
 * period and subject can be reloaded. « Dates choisies » shows « Du », « Au » and « Type de
 * bulletin ». A new period or subject chooses its own bank, so the bank list waits for
 * « Afficher ». The student open (`#eleve-<id>`) stays open. « Du » and « Au » stay inside the
 * school year (the server checks it too, `composerPeriod`).
 */
export function ComposerFilters({
  classId,
  periods,
  subjects,
  banks,
  year,
  values,
}: {
  classId: string;
  periods: { value: ReportPeriodKind | 'custom'; label: string }[];
  subjects: { key: string; label: string; group: 'mine' | 'learning_skills' | 'other' }[];
  banks: { id: string; label: string }[];
  year: { startsOn: LocalDate; endsOn: LocalDate };
  values: ComposerFilterValues;
}) {
  const t = useTranslations('reportComments.filters');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState(values.period);
  const [subject, setSubject] = useState(values.subject);
  const id = useId();
  const bankStale = period !== values.period || subject !== values.subject;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    };
    // The student open stays open (the fragment never leaves the browser).
    const hash = /^#eleve-[0-9a-f-]{36}$/i.test(window.location.hash) ? window.location.hash : '';
    startTransition(() =>
      router.push(
        composerHref(classId, {
          period: (text('period') ?? values.period) as ComposerFilterValues['period'],
          from: text('from'),
          to: text('to'),
          kind: text('kind') === 'progress' ? 'progress' : 'term',
          subject: text('subject'),
          bank: bankStale ? null : text('bank'),
        }) + hash,
      ),
    );
  };

  const mine = subjects.filter((s) => s.group === 'mine');
  const others = subjects.filter((s) => s.group === 'other');
  const skills = subjects.find((s) => s.group === 'learning_skills');
  const skillsFirst = subjects[0]?.group === 'learning_skills';
  const skillsOption = skills ? <option value={skills.key}>{skills.label}</option> : null;

  return (
    <form
      method="get"
      action={`/classes/${classId}/bulletins`}
      onSubmit={submit}
      aria-busy={pending}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-slate-900">{t('legend')}</legend>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-[3] basis-[34rem] space-y-1.5">
            <Label htmlFor={`${id}-period`}>{t('period')}</Label>
            <Select
              id={`${id}-period`}
              name="period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as ComposerFilterValues['period'])}
            >
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          {period === 'custom' ? (
            <>
              <div className="min-w-0 flex-1 basis-36 space-y-1.5">
                <Label htmlFor={`${id}-from`}>{t('from')}</Label>
                <Input
                  id={`${id}-from`}
                  type="date"
                  name="from"
                  min={year.startsOn}
                  max={year.endsOn}
                  defaultValue={values.from ?? year.startsOn}
                />
              </div>
              <div className="min-w-0 flex-1 basis-36 space-y-1.5">
                <Label htmlFor={`${id}-to`}>{t('to')}</Label>
                <Input
                  id={`${id}-to`}
                  type="date"
                  name="to"
                  min={year.startsOn}
                  max={year.endsOn}
                  defaultValue={values.to ?? year.endsOn}
                />
              </div>
              <div className="min-w-0 flex-1 basis-48 space-y-1.5">
                <Label htmlFor={`${id}-kind`}>{t('kind')}</Label>
                <Select id={`${id}-kind`} name="kind" defaultValue={values.kind}>
                  <option value="progress">{t('kinds.progress')}</option>
                  <option value="term">{t('kinds.term')}</option>
                </Select>
              </div>
            </>
          ) : null}
          <div className="min-w-0 flex-[2] basis-56 space-y-1.5">
            <Label htmlFor={`${id}-subject`}>{t('subject')}</Label>
            <Select
              id={`${id}-subject`}
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              {skillsFirst ? skillsOption : null}
              {mine.length > 0 ? (
                <optgroup label={t('mine')}>
                  {mine.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {skillsFirst ? null : skillsOption}
              {others.length > 0 ? (
                <optgroup label={t('others')}>
                  {others.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </div>
          {banks.length > 0 ? (
            <div className="min-w-0 flex-[2] basis-[28rem] space-y-1.5">
              <Label htmlFor={`${id}-bank`}>{t('bank')}</Label>
              <Select
                id={`${id}-bank`}
                name="bank"
                defaultValue={values.bank ?? ''}
                disabled={bankStale}
                aria-describedby={bankStale ? `${id}-bank-hint` : undefined}
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <Button type="submit" disabled={pending} className="shrink-0">
            {t('apply')}
          </Button>
        </div>
        {bankStale && banks.length > 0 ? (
          <p id={`${id}-bank-hint`} className="text-sm text-slate-600">
            {t('bankLater')}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
