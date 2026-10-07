'use client';

import { Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useErrorText } from '@/hooks/use-action';
import { endSession, setKeepResults } from '@/server/actions/class-mode';

/**
 * « Terminer la séance » (DECISIONS D-089): « Les réponses des élèves seront effacées. », with
 * « Garder les résultats de la classe (sans noms) » unchecked by default. The box is saved as
 * soon as it changes (`set_class_session_keep`), so the choice also applies if the session
 * expires before the teacher ends it. On the projector and on the class tab (a forgotten session
 * can be ended from a phone).
 */
export function EndSessionDialog({
  sessionId,
  keep: initialKeep,
  retentionDays,
  onEnded,
  size = 'md',
  variant = 'secondary',
}: {
  sessionId: string;
  keep: boolean;
  /** The board's `classModeResultsRetentionDays`. */
  retentionDays: number;
  /** After the session ended (the projector goes back to the class tab). */
  onEnded: (classId: string | null) => void;
  size?: 'md' | 'lg';
  variant?: 'secondary' | 'primary';
}) {
  const t = useTranslations('classMode.end');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState(initialKeep);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changeKeep = (value: boolean) => {
    setKeep(value);
    startTransition(async () => {
      try {
        const result = await setKeepResults(sessionId, value);
        if (!result.ok && result.error !== 'classSessionEnded') setError(result.error);
      } catch {
        setError('network');
      }
    });
  };

  const end = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await endSession(sessionId, keep);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        toast.success(t('done'));
        onEnded(result.data.classId);
      } catch {
        setError('network');
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Square aria-hidden />
        {t('open')}
      </Button>
      <DialogContent title={t('title')} closeLabel={tCommon('close')}>
        <div className="space-y-5">
          <p className="text-slate-800">{t('body')}</p>
          <label htmlFor={`${id}-keep`} className="flex min-h-11 cursor-pointer gap-3">
            <input
              id={`${id}-keep`}
              type="checkbox"
              checked={keep}
              onChange={(e) => changeKeep(e.target.checked)}
              aria-labelledby={`${id}-keep-label`}
              aria-describedby={`${id}-keep-hint`}
              className="mt-0.5 size-6 shrink-0 accent-brand-600"
            />
            <span>
              <span id={`${id}-keep-label`} className="block font-medium text-slate-900">
                {t('keep')}
              </span>
              <span id={`${id}-keep-hint`} className="block text-sm text-slate-600">
                {t('keepHint', { days: retentionDays })}
              </span>
            </span>
          </label>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {errorText(error)}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button disabled={pending} onClick={end}>
              {t('confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
