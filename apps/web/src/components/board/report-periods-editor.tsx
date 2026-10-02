'use client';

import {
  REPORT_PERIOD_KINDS,
  reportPeriodInYear,
  type ReportPeriod,
  type ReportPeriodKind,
} from '@lynx/domain';
import { CalendarRange, Eraser, Wand2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Notice } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { formatLocalDate } from '@/lib/format';
import {
  prefillReportPeriods,
  saveReportPeriods,
  type ReportPeriodsProposal,
} from '@/server/actions/board';

interface PeriodFields {
  startsOn: string;
  endsOn: string;
  dueOn: string;
  issuedOn: string;
}

type Fields = Record<ReportPeriodKind, PeriodFields>;

const FIELDS = ['startsOn', 'endsOn', 'dueOn', 'issuedOn'] as const;
const BLANK: PeriodFields = { startsOn: '', endsOn: '', dueOn: '', issuedOn: '' };

function fieldsOf(periods: readonly ReportPeriod[]): Fields {
  const fields = { progress: BLANK, term1: BLANK, term2: BLANK };
  for (const p of periods) {
    fields[p.kind] = {
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      dueOn: p.dueOn ?? '',
      issuedOn: p.issuedOn ?? '',
    };
  }
  return fields;
}

export interface ReportPeriodsYear {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  periods: ReportPeriod[];
}

/**
 * « Périodes de bulletin » of a school year (DECISIONS D-124): the three Ontario report cards,
 * each an evaluation window and two optional dates, shown in words on the year's card and edited
 * in one dialog. « Préremplir avec les dates habituelles » proposes the usual dates (nothing is
 * saved until « Enregistrer »); a period left blank is removed.
 */
export function ReportPeriodsEditor({
  boardId,
  year,
}: {
  boardId: string;
  year: ReportPeriodsYear;
}) {
  const t = useTranslations('board.years.periods');
  const tKinds = useTranslations('reportPeriods');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(year.periods));
  const [prefilled, setPrefilled] = useState(false);
  const save = useAction(saveReportPeriods, {
    successMessage: t('saved'),
    onSuccess: () => {
      setOpen(false);
      setPrefilled(false);
    },
  });
  const prefill = useAction(prefillReportPeriods, {
    onSuccess: (proposal: ReportPeriodsProposal) => {
      const next = { ...fields };
      for (const kind of REPORT_PERIOD_KINDS) {
        const p = proposal[kind];
        if (p) {
          next[kind] = {
            startsOn: p.startsOn,
            endsOn: p.endsOn,
            dueOn: p.dueOn ?? '',
            issuedOn: p.issuedOn ?? '',
          };
        }
      }
      setFields(next);
      setPrefilled(true);
    },
  });

  const long = (d: string) =>
    formatLocalDate(d, locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const short = (d: string) => formatLocalDate(d, locale, { day: 'numeric', month: 'long' });
  const id = (kind: ReportPeriodKind, field: string) => `period-${year.id}-${kind}-${field}`;
  const set = (kind: ReportPeriodKind, field: keyof PeriodFields, value: string) =>
    setFields((f) => ({ ...f, [kind]: { ...f[kind], [field]: value } }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = Object.fromEntries(
      REPORT_PERIOD_KINDS.map((kind) => {
        const f = fields[kind];
        return [kind, FIELDS.every((k) => f[k] === '') ? null : f];
      }),
    ) as Record<ReportPeriodKind, PeriodFields | null>;
    void save.run(boardId, year.id, input);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-900">{t('title')}</p>
      {year.periods.length === 0 ? (
        <p className="text-sm text-slate-600">{t('none')}</p>
      ) : (
        <dl className="space-y-1 text-sm">
          {year.periods.map((p) => (
            <div key={p.kind} className="sm:flex sm:gap-2">
              <dt className="font-medium text-slate-900">{tKinds(`kinds.${p.kind}`)}</dt>
              <dd className="text-slate-700">
                {[
                  t('window', { start: long(p.startsOn), end: long(p.endsOn) }),
                  p.dueOn ? t('due', { date: short(p.dueOn) }) : null,
                  p.issuedOn ? t('issued', { date: short(p.issuedOn) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                {reportPeriodInYear(p, year) ? null : (
                  <Badge tone="warning">{tKinds('outsideYear')}</Badge>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary" aria-label={t('openLabel', { name: year.name })}>
            <CalendarRange aria-hidden />
            {t('open')}
          </Button>
        </DialogTrigger>
        <DialogContent
          title={t('dialogTitle', { name: year.name })}
          description={t('intro')}
          closeLabel={tCommon('close')}
          className="sm:max-w-2xl"
        >
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Button
                variant="secondary"
                disabled={prefill.pending}
                onClick={() => void prefill.run(boardId, year.id)}
              >
                <Wand2 aria-hidden />
                {t('prefill')}
              </Button>
              {prefilled ? <Notice tone="warning">{t('prefillNote')}</Notice> : null}
            </div>
            {REPORT_PERIOD_KINDS.map((kind) => (
              <fieldset key={kind} className="space-y-3 rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold text-slate-900">
                  {tKinds(`kinds.${kind}`)}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS.map((field) => (
                    <Field
                      key={field}
                      label={t(field)}
                      htmlFor={id(kind, field)}
                      error={save.fieldError(`${kind}.${field}`)}
                    >
                      <Input
                        id={id(kind, field)}
                        type="date"
                        value={fields[kind][field]}
                        min={
                          field === 'startsOn' ? year.startsOn : fields[kind].startsOn || undefined
                        }
                        max={field === 'endsOn' || field === 'startsOn' ? year.endsOn : undefined}
                        aria-invalid={Boolean(save.fieldError(`${kind}.${field}`))}
                        onChange={(e) => set(kind, field, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('clearLabel', { kind: tKinds(`kinds.${kind}`) })}
                  onClick={() => setFields((f) => ({ ...f, [kind]: BLANK }))}
                >
                  <Eraser aria-hidden />
                  {t('clear')}
                </Button>
              </fieldset>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={save.pending}>
                {save.pending ? tCommon('saving') : tCommon('save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
