'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { useErrorText } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import type { ActionResult } from '@/lib/action-result';

/**
 * A decision that needs a note for the author (« Renvoyer pour révision », « Retirer de la
 * banque »). The note is kept on the device until it is sent (D-035), per user and item (D-044);
 * it is shown to the author and never audited (D-079).
 */
export function RejectDialog({
  userId,
  itemId,
  kind,
  label,
  title,
  intro,
  submitLabel,
  onSubmit,
  successMessage,
  variant = 'secondary',
}: {
  userId: string;
  itemId: string;
  /** Keeps a note per decision (`reject`, `faith`, `retract`). */
  kind: string;
  label: string;
  title: string;
  intro: string;
  submitLabel: string;
  /** The server action, given the note. */
  onSubmit: (note: string) => Promise<ActionResult>;
  /** Shown once it is done. */
  successMessage: string;
  variant?: 'secondary' | 'danger';
}) {
  const t = useTranslations('libraryReview');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = useDraft(`library-note:${userId}:${itemId}:${kind}`, { note: '' });
  const id = `note-${kind}-${itemId}`;

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={intro} closeLabel={tCommon('close')}>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.value.note.trim()) {
                setError('required');
                return;
              }
              setPending(true);
              setError(null);
              try {
                const result = await onSubmit(draft.value.note.trim());
                if (result.ok) {
                  draft.clear();
                  setOpen(false);
                  toast.success(successMessage);
                  router.refresh();
                } else {
                  setError(result.fieldErrors?.note ?? result.error);
                }
              } catch {
                // The note stays on the device.
                setError('network');
              } finally {
                setPending(false);
              }
            }}
          >
            <Field
              label={t('note')}
              htmlFor={id}
              hint={t('noteHint')}
              error={error ? (errorText(error) ?? undefined) : undefined}
            >
              <Textarea
                id={id}
                value={draft.value.note}
                maxLength={1000}
                className="min-h-28"
                onChange={(e) => draft.update('note', e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="submit"
                variant={variant === 'danger' ? 'danger' : 'primary'}
                disabled={pending}
              >
                {submitLabel}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
