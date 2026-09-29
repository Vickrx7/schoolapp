'use client';

import { ABSENCE_MAX_DAYS, addDays, type AbsencePart } from '@lynx/domain';
import { Pencil, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Label, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { cn } from '@/lib/utils';
import { cancelAbsence, refreshAbsencePlans, updateAbsence } from '@/server/actions/absences';

export interface EditableAbsence {
  id: string;
  startsOn: string;
  endsOn: string;
  part: AbsencePart;
  note: string | null;
  catholicConnection: boolean;
}

/**
 * The owner's actions on an absence: « Modifier / Je reviens plus tôt » (a new last day, morning
 * or afternoon for a single day, the note, the faith moment), « Mettre à jour le plan » and
 * « Annuler l'absence ».
 */
export function AbsenceActions({
  absence,
  canRefresh,
}: {
  absence: EditableAbsence;
  canRefresh: boolean;
}) {
  const t = useTranslations('absences');
  const router = useRouter();
  const refresh = useAction(refreshAbsencePlans, { successMessage: t('refreshed') });
  const cancel = useAction(cancelAbsence, {
    onSuccess: () => {
      toast.success(t('cancelled'));
      router.push('/absences');
    },
  });

  return (
    <div className="flex flex-wrap gap-2">
      <EditAbsenceDialog absence={absence} />
      {canRefresh ? (
        <Button
          variant="secondary"
          disabled={refresh.pending}
          onClick={() => void refresh.run(absence.id)}
        >
          <RefreshCw aria-hidden className={cn(refresh.pending && 'animate-spin')} />
          {t('refreshPlans')}
        </Button>
      ) : null}
      <ConfirmButton
        label={t('cancel')}
        message={t('cancelConfirm')}
        confirmLabel={t('cancel')}
        size="md"
        onConfirm={() => cancel.run(absence.id)}
      />
    </div>
  );
}

function EditAbsenceDialog({ absence }: { absence: EditableAbsence }) {
  const t = useTranslations('absences');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [endsOn, setEndsOn] = useState(absence.endsOn);
  const [part, setPart] = useState<AbsencePart>(absence.part);
  const [note, setNote] = useState(absence.note ?? '');
  const [faith, setFaith] = useState(absence.catholicConnection);
  const save = useAction(updateAbsence, {
    successMessage: t('updated'),
    onSuccess: () => setOpen(false),
  });
  const singleDay = endsOn === absence.startsOn;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(absence.id, {
      endsOn,
      part: singleDay ? part : 'full_day',
      note,
      catholicConnection: faith,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Start from the saved absence each time.
          setEndsOn(absence.endsOn);
          setPart(absence.part);
          setNote(absence.note ?? '');
          setFaith(absence.catholicConnection);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Pencil aria-hidden />
          {t('edit')}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t('editTitle')}
        description={t('editHint')}
        closeLabel={tCommon('close')}
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={t('endsOn')} htmlFor="edit-ends-on" error={save.fieldError('endsOn')}>
            <Input
              id="edit-ends-on"
              type="date"
              min={absence.startsOn}
              max={addDays(absence.startsOn, ABSENCE_MAX_DAYS - 1)}
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </Field>
          <fieldset className="space-y-2" disabled={!singleDay}>
            <legend className="text-sm font-medium text-slate-700">{t('partLabel')}</legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
              {(['full_day', 'am', 'pm'] as const).map((p) => (
                <label
                  key={p}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
                    (singleDay ? part : 'full_day') === p
                      ? 'bg-white text-brand-800 shadow-sm'
                      : 'text-slate-600',
                    !singleDay && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="edit-part"
                    className="sr-only"
                    checked={(singleDay ? part : 'full_day') === p}
                    onChange={() => setPart(p)}
                  />
                  {t(`part.${p}`)}
                </label>
              ))}
            </div>
            {save.fieldError('part') ? (
              <p className="text-sm text-red-600" role="alert">
                {save.fieldError('part')}
              </p>
            ) : null}
          </fieldset>
          <Field
            label={`${t('note')} (${tCommon('optional')})`}
            htmlFor="edit-note"
            hint={t('noteHint')}
            error={save.fieldError('note')}
          >
            <Textarea
              id="edit-note"
              value={note}
              maxLength={1000}
              className="min-h-20"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-faith">{t('faith')}</Label>
            <input
              id="edit-faith"
              type="checkbox"
              role="switch"
              className="size-6 shrink-0 accent-brand-600"
              checked={faith}
              onChange={(e) => setFaith(e.target.checked)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={save.pending || !endsOn}>
              {save.pending ? tCommon('saving') : t('editSave')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
