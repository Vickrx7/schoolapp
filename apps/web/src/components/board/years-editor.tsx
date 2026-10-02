'use client';

import { CalendarPlus, Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/page';
import { useAction } from '@/hooks/use-action';
import { formatLocalDate } from '@/lib/format';
import { deleteSchoolYear, saveSchoolYear } from '@/server/actions/board';

export interface YearRow {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

/** Adds or changes a school year; what was typed stays after an error or a close. */
function YearDialog({
  boardId,
  year,
  title,
  trigger,
}: {
  boardId: string;
  year: YearRow | null;
  title: string;
  trigger: ReactNode;
}) {
  const t = useTranslations('board.years');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(year?.name ?? '');
  const [startsOn, setStartsOn] = useState(year?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(year?.endsOn ?? '');
  const save = useAction(saveSchoolYear, {
    successMessage: t('saved'),
    onSuccess: () => {
      setOpen(false);
      if (!year) {
        setName('');
        setStartsOn('');
        setEndsOn('');
      }
    },
  });
  const id = (field: string) => `year-${field}-${year?.id ?? 'new'}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(boardId, year?.id ?? null, { name, startsOn, endsOn });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} closeLabel={tCommon('close')}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={t('name')} htmlFor={id('name')} error={save.fieldError('name')}>
            <Input
              id={id('name')}
              value={name}
              maxLength={40}
              placeholder={t('namePlaceholder')}
              aria-invalid={Boolean(save.fieldError('name'))}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('startsOn')} htmlFor={id('starts')} error={save.fieldError('startsOn')}>
              <Input
                id={id('starts')}
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </Field>
            <Field label={t('endsOn')} htmlFor={id('ends')} error={save.fieldError('endsOn')}>
              <Input
                id={id('ends')}
                type="date"
                value={endsOn}
                min={startsOn || undefined}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </Field>
          </div>
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
  );
}

/**
 * « Années scolaires » (DECISIONS D-107): add, rename or change the dates of the board's school
 * years. Deleting one that classes use is refused (`inUse`).
 */
export function YearsEditor({
  boardId,
  years,
  today,
}: {
  boardId: string;
  years: YearRow[];
  today: string;
}) {
  const t = useTranslations('board.years');
  const locale = useLocale();
  const remove = useAction(deleteSchoolYear, { successMessage: t('deleted') });
  const date = (d: string) =>
    formatLocalDate(d, locale, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <YearDialog
        boardId={boardId}
        year={null}
        title={t('add')}
        trigger={
          <Button>
            <CalendarPlus aria-hidden />
            {t('add')}
          </Button>
        }
      />
      {years.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-2">
          {years.map((y) => (
            <li key={y.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    {y.name}
                    {y.startsOn <= today && today <= y.endsOn ? (
                      <Badge tone="brand">{t('current')}</Badge>
                    ) : null}
                  </p>
                  <p className="text-sm text-slate-600">
                    {t('dates', { start: date(y.startsOn), end: date(y.endsOn) })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <YearDialog
                    boardId={boardId}
                    year={y}
                    title={t('editTitle', { name: y.name })}
                    trigger={
                      <Button variant="secondary" aria-label={t('editTitle', { name: y.name })}>
                        <Pencil aria-hidden />
                        {t('edit')}
                      </Button>
                    }
                  />
                  <ConfirmButton
                    label={t('deleteLabel', { name: y.name })}
                    message={t('deleteConfirm', { name: y.name })}
                    confirmLabel={t('delete')}
                    size="md"
                    onConfirm={() => remove.run(y.id)}
                  >
                    {t('delete')}
                  </ConfirmButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
