'use client';

import {
  mondayOf,
  unitSchoolDays,
  weeksOf,
  weekWindow,
  type DateWindow,
  type SchoolWeek,
} from '@lynx/domain';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { formatLocalDate } from '@/lib/format';
import { loadExpectationOptions, saveUnitPlan } from '@/server/actions/year-plan';
import type { ExpectationChoice } from '@/server/queries/year-plan';
import { ExpectationPicker } from './expectation-picker';

export interface PlannedUnit {
  id: string;
  subjectId: string;
  title: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  expectationIds: string[];
}

/** The weeks the selects offer: what `SchoolWeek` holds, without the events. */
export type PlanWeek = Pick<SchoolWeek, 'monday' | 'days' | 'schoolDays' | 'daysOff'>;

/**
 * « Planifier une unité » / « Planification de l'unité » (DECISIONS D-123): the title, the first
 * and last week (saved as their first and last weekday, clamped to the school year), with the
 * weeks and school days they hold, the attentes the unit aims at and its description. A new unit
 * is « À venir ». What was typed stays after an error or a close.
 */
export function UnitPlanDialog({
  classId,
  unit,
  subjects = [],
  weeks,
  year,
  expectations,
  trigger,
  showOpenUnit = false,
}: {
  classId: string;
  /** Null: a new unit. */
  unit: PlannedUnit | null;
  /** The subjects a new unit may take. */
  subjects?: { id: string; label: string }[];
  weeks: PlanWeek[];
  year: DateWindow;
  /** The attentes of the unit's subject, when the page has them already. */
  expectations?: ExpectationChoice[];
  trigger: ReactNode;
  /** « Ouvrir l'unité » after saving (from the year view). */
  showOpenUnit?: boolean;
}) {
  const t = useTranslations('yearPlan.dialog');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(unit?.subjectId ?? subjects[0]?.id ?? '');
  const [title, setTitle] = useState(unit?.title ?? '');
  const [description, setDescription] = useState(unit?.description ?? '');
  const [first, setFirst] = useState(unit?.startsOn ? mondayOf(unit.startsOn) : '');
  const [last, setLast] = useState(unit?.endsOn ? mondayOf(unit.endsOn) : '');
  const [chosen, setChosen] = useState<string[]>(unit?.expectationIds ?? []);
  const [options, setOptions] = useState<{ subjectId: string; list: ExpectationChoice[] } | null>(
    expectations && unit ? { subjectId: unit.subjectId, list: expectations } : null,
  );
  const openAfter = useRef(false);

  // The attentes of the chosen subject, loaded when the dialog opens or the subject changes.
  const needed = open && subjectId !== '' && options?.subjectId !== subjectId;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    loadExpectationOptions(classId, subjectId)
      .then((result) => {
        if (!cancelled) setOptions({ subjectId, list: result.ok ? result.data : [] });
      })
      .catch(() => {
        if (!cancelled) setOptions({ subjectId, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [needed, classId, subjectId]);
  const list = options?.subjectId === subjectId ? options.list : null;

  const save = useAction(saveUnitPlan, {
    successMessage: t('saved'),
    onSuccess: ({ id }) => {
      setOpen(false);
      if (openAfter.current) router.push(`/classes/${classId}/planning/${id}`);
      else if (!unit) {
        setTitle('');
        setDescription('');
        setFirst('');
        setLast('');
        setChosen([]);
      }
    },
  });

  // A saved window outside today's weeks (a year edited since) keeps its own option.
  const mondays = new Set(weeks.map((w) => w.monday));
  const extra = [first, last].filter((m) => m && !mondays.has(m));
  const weekLabel = (w: PlanWeek) =>
    t('week', {
      date: formatLocalDate(w.days[0] ?? w.monday, locale, { day: 'numeric', month: 'long' }),
      days: w.schoolDays,
    });
  const weekOptions = (
    <>
      <option value="">{t('noWeek')}</option>
      {[...new Set(extra)].map((m) => (
        <option key={m} value={m}>
          {formatLocalDate(m, locale, { day: 'numeric', month: 'long', year: 'numeric' })}
        </option>
      ))}
      {weeks.map((w) => (
        <option key={w.monday} value={w.monday}>
          {weekLabel(w)}
        </option>
      ))}
    </>
  );
  const span = first && last ? weekWindow(first, last, year) : null;
  const id = (field: string) => `unit-plan-${field}-${unit?.id ?? 'new'}`;

  const submit = (e: FormEvent, andOpen = false) => {
    e.preventDefault();
    openAfter.current = andOpen;
    void save.run(unit?.id ?? null, {
      classId,
      subjectId,
      title,
      description,
      startsOn: span?.startsOn ?? (first || null),
      endsOn: span?.endsOn ?? (last || null),
      expectationIds: chosen,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={unit ? t('editTitle') : t('newTitle')}
        closeLabel={tCommon('close')}
        className="sm:max-w-2xl"
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          {unit ? null : (
            <Field
              label={t('subject')}
              htmlFor={id('subject')}
              error={save.fieldError('subjectId')}
            >
              <Select
                id={id('subject')}
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setChosen([]);
                }}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('unitTitle')} htmlFor={id('title')} error={save.fieldError('title')}>
            <Input
              id={id('title')}
              value={title}
              maxLength={120}
              aria-invalid={Boolean(save.fieldError('title'))}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="space-y-3">
            <Field label={t('firstWeek')} htmlFor={id('first')} error={save.fieldError('startsOn')}>
              <Select
                id={id('first')}
                value={first}
                aria-invalid={Boolean(save.fieldError('startsOn'))}
                onChange={(e) => {
                  const value = e.target.value;
                  setFirst(value);
                  if (value && (!last || last < value)) setLast(value);
                  if (!value) setLast('');
                }}
              >
                {weekOptions}
              </Select>
            </Field>
            <Field label={t('lastWeek')} htmlFor={id('last')} error={save.fieldError('endsOn')}>
              <Select
                id={id('last')}
                value={last}
                aria-invalid={Boolean(save.fieldError('endsOn'))}
                onChange={(e) => {
                  const value = e.target.value;
                  setLast(value);
                  if (value && (!first || first > value)) setFirst(value);
                  if (!value) setFirst('');
                }}
              >
                {weekOptions}
              </Select>
            </Field>
          </div>
          {span ? (
            <p className="text-sm text-slate-700" aria-live="polite">
              {t('summary', {
                weeks: weeksOf(span, weeks).length,
                days: unitSchoolDays(span, weeks),
              })}
            </p>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">{t('expectations')}</legend>
            <p className="text-sm text-slate-600">{t('expectationsHint')}</p>
            {list === null ? (
              <p className="text-sm text-slate-600" role="status">
                {t('loading')}
              </p>
            ) : list.length === 0 ? (
              <p className="text-sm text-slate-600">{t('noneLoaded')}</p>
            ) : (
              <>
                {list.some((o) => !o.verified) ? (
                  <Notice tone="warning">{t('unverifiedNotice')}</Notice>
                ) : null}
                <ExpectationPicker options={list} selected={chosen} onChange={setChosen} />
              </>
            )}
            {save.fieldError('expectationIds') ? (
              <p className="text-sm text-red-600" role="alert">
                {save.fieldError('expectationIds')}
              </p>
            ) : null}
          </fieldset>
          <Field label={t('description')} htmlFor={id('description')}>
            <Textarea
              id={id('description')}
              value={description}
              maxLength={2000}
              className="min-h-20"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            {showOpenUnit ? (
              <Button variant="secondary" disabled={save.pending} onClick={(e) => submit(e, true)}>
                {t('openUnit')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.pending}>
              {save.pending ? tCommon('saving') : t('save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
