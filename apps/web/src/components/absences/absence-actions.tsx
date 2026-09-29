'use client';

import { ABSENCE_MAX_DAYS, addDays, type AbsencePart } from '@lynx/domain';
import { Pencil, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input, Label, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
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
  userId,
  absence,
  canRefresh,
}: {
  /** The signed-in user: the edit form's draft is kept per user. */
  userId: string;
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
      <EditAbsenceDialog
        // Starts over from the saved absence when it changes (a draft made from the older one is
        // then offered, not restored).
        key={[absence.endsOn, absence.part, absence.note, absence.catholicConnection].join('|')}
        userId={userId}
        absence={absence}
      />
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

/**
 * « Modifier / Je reviens plus tôt ». What she types is kept on the device (D-035) until it is
 * saved, so closing the dialog by accident (a tap outside it, Escape) loses nothing; « Annuler »
 * drops it. A draft made from an absence changed since (another device) is offered, not restored.
 */
function EditAbsenceDialog({ userId, absence }: { userId: string; absence: EditableAbsence }) {
  const t = useTranslations('absences');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const initial = useMemo(
    () => ({
      endsOn: absence.endsOn,
      part: absence.part,
      note: absence.note ?? '',
      faith: absence.catholicConnection,
    }),
    [absence.endsOn, absence.part, absence.note, absence.catholicConnection],
  );
  const draft = useDraft(`absence-edit:${userId}:${absence.id}`, initial, {
    // The saved absence the draft was made from.
    version: JSON.stringify(initial),
  });
  const { endsOn, part, note, faith } = draft.value;
  const { update, clear: clearDraft } = draft;
  const save = useAction(updateAbsence, {
    successMessage: t('updated'),
    onSuccess: () => {
      clearDraft();
      setOpen(false);
    },
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
    <Dialog open={open} onOpenChange={setOpen}>
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
          {draft.restored ? <Notice>{tCommon('draftRestored')}</Notice> : null}
          {draft.offered ? (
            <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('editDraftOffered')}</span>
              <Button variant="secondary" size="sm" onClick={draft.recover}>
                {t('editDraftRecover')}
              </Button>
            </Notice>
          ) : null}
          <Field label={t('endsOn')} htmlFor="edit-ends-on" error={save.fieldError('endsOn')}>
            <Input
              id="edit-ends-on"
              type="date"
              min={absence.startsOn}
              max={addDays(absence.startsOn, ABSENCE_MAX_DAYS - 1)}
              value={endsOn}
              onChange={(e) => update('endsOn', e.target.value)}
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
                    onChange={() => update('part', p)}
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
              onChange={(e) => update('note', e.target.value)}
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
              onChange={(e) => update('faith', e.target.checked)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                // « Annuler »: back to the saved absence.
                draft.discard();
                setOpen(false);
              }}
            >
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
