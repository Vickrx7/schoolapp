'use client';

import type { LocalDate } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import {
  classCoverageHref,
  type ClassCoverageShow,
  type CoveragePeriodChoice,
} from '@/server/planning/coverage-view';

export interface CoverageFilterValues {
  subject: string | null;
  grade: string | null;
  period: CoveragePeriodChoice;
  from: LocalDate | null;
  to: LocalDate | null;
  show: ClassCoverageShow;
}

/**
 * « Matière », « Année d'études » (a class of several grades), « Période » and, for « Dates
 * choisies », « Du … au … » (DECISIONS D-125): a GET form whose fields are the page's address,
 * read back by the server, so a filtered coverage can be reloaded and works without JavaScript.
 * With JavaScript the dates appear only for « Dates choisies », and the address leaves out the
 * defaults. « Afficher » keeps its value (it is a row of links beside the list). The page keys it
 * by its address, so a new address (back, a link) shows its own values.
 */
export function ClassCoverageFilters({
  classId,
  subjects,
  grades,
  periods,
  year,
  values,
}: {
  classId: string;
  subjects: { id: string; label: string }[];
  /** Offered only for a class of several grades. */
  grades: { code: string; label: string }[];
  /** « Toute l'année », the board's report periods, « Dates choisies », labelled. */
  periods: { value: CoveragePeriodChoice; label: string }[];
  year: { startsOn: LocalDate; endsOn: LocalDate };
  values: CoverageFilterValues;
}) {
  const t = useTranslations('classCoverage.filters');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState<CoveragePeriodChoice>(values.period);
  const id = useId();
  const action = `/classes/${classId}/planning/coverage`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    };
    const chosen = (text('period') ?? 'year') as CoveragePeriodChoice;
    startTransition(() =>
      router.push(
        classCoverageHref(classId, {
          subject: text('subject'),
          grade: text('grade'),
          period: chosen,
          from: text('from'),
          to: text('to'),
          show: values.show,
        }),
      ),
    );
  };

  return (
    <form
      method="get"
      action={action}
      onSubmit={submit}
      aria-busy={pending}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-slate-900">{t('legend')}</legend>
        {values.show !== 'all' ? <input type="hidden" name="show" value={values.show} /> : null}
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1 basis-56 space-y-1.5">
            <Label htmlFor={`${id}-subject`}>{t('subject')}</Label>
            <Select id={`${id}-subject`} name="subject" defaultValue={values.subject ?? ''}>
              <option value="">{t('overview')}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          {grades.length > 1 ? (
            <div className="min-w-0 flex-1 basis-40 space-y-1.5">
              <Label htmlFor={`${id}-grade`}>{t('grade')}</Label>
              <Select id={`${id}-grade`} name="grade" defaultValue={values.grade ?? ''}>
                {grades.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="min-w-0 flex-[2] basis-64 space-y-1.5">
            <Label htmlFor={`${id}-period`}>{t('period')}</Label>
            <Select
              id={`${id}-period`}
              name="period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as CoveragePeriodChoice)}
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
                  defaultValue={values.from ?? year.startsOn}
                  aria-describedby={`${id}-dates-hint`}
                />
              </div>
              <div className="min-w-0 flex-1 basis-36 space-y-1.5">
                <Label htmlFor={`${id}-to`}>{t('to')}</Label>
                <Input
                  id={`${id}-to`}
                  type="date"
                  name="to"
                  defaultValue={values.to ?? year.endsOn}
                  aria-describedby={`${id}-dates-hint`}
                />
              </div>
            </>
          ) : null}
          <Button type="submit" disabled={pending} className="shrink-0">
            {t('apply')}
          </Button>
        </div>
        {period === 'custom' ? (
          <p id={`${id}-dates-hint`} className="text-sm text-slate-600">
            {t('customHint')}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
