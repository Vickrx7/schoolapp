'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export interface NamesCheckState {
  /** Students' first names found in the resource. */
  names: string[];
  /** Kinds of personal detail found (always to remove). */
  blocked: string[];
}

/**
 * The first-name guard's question (DECISIONS D-066): « Ces prénoms sont ceux d'élèves de votre
 * école : Samuel. Retirez-les, ou cochez « Ce n'est pas un nom d'élève » (ex. saint Thomas,
 * Samuel de Champlain). » Each name is confirmed on its own; e-mail addresses, phone numbers and
 * other personal details can only be removed. Used before sharing, proposing to the board and
 * saving a shared resource.
 */
export function NamesDialog({
  state,
  pending,
  onClose,
  onConfirm,
  confirmLabel,
}: {
  state: NamesCheckState | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (confirmedNames: string[]) => void;
  confirmLabel: string;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {state ? (
        <NamesDialogBody
          key={[...state.names, ...state.blocked].join('|')}
          state={state}
          pending={pending}
          onClose={onClose}
          onConfirm={onConfirm}
          confirmLabel={confirmLabel}
        />
      ) : null}
    </Dialog>
  );
}

function NamesDialogBody({
  state,
  pending,
  onClose,
  onConfirm,
  confirmLabel,
}: {
  state: NamesCheckState;
  pending: boolean;
  onClose: () => void;
  onConfirm: (confirmedNames: string[]) => void;
  confirmLabel: string;
}) {
  const t = useTranslations('libraryEdit.names');
  const tBlocked = useTranslations('differentiate.blocked');
  const tCommon = useTranslations('common');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const blocked = state.blocked.length > 0;
  const ready = !blocked && state.names.every((n) => confirmed.includes(n));

  return (
    <DialogContent title={t('title')} closeLabel={tCommon('close')}>
      <div className="space-y-4">
        {blocked ? (
          <Notice tone="danger" role="alert">
            <p>{t('blocked')}</p>
            <ul className="mt-1 list-disc pl-5">
              {state.blocked.map((kind) => (
                <li key={kind}>
                  {tBlocked.has(kind as 'email') ? tBlocked(kind as 'email') : kind}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {state.names.length ? (
          <fieldset className="space-y-2">
            <legend className="text-slate-800">
              {t('intro', { names: state.names.join(', ') })}
            </legend>
            {state.names.map((name) => (
              <label
                key={name}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  checked={confirmed.includes(name)}
                  onChange={(e) =>
                    setConfirmed((prev) =>
                      e.target.checked ? [...prev, name] : prev.filter((n) => n !== name),
                    )
                  }
                />
                {t('notAStudent', { name })}
              </label>
            ))}
          </fieldset>
        ) : null}
        <p className="text-sm text-slate-600">{t('hint')}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('edit')}
          </Button>
          <Button disabled={!ready || pending} onClick={() => onConfirm(confirmed)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
