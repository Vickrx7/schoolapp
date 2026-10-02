'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { FEEDBACK_KINDS, FEEDBACK_MAX, deviceClass, type FeedbackKind } from '@/lib/feedback';
import { cn } from '@/lib/utils';
import { sendFeedback } from '@/server/actions/feedback';

interface Draft {
  kind: FeedbackKind;
  message: string;
  mayContact: boolean;
}

const EMPTY: Draft = { kind: 'problem', message: '', mayContact: true };

/**
 * « Envoyer un commentaire » (DECISIONS D-116): the kind, the message with its counter (kept as
 * a draft on this device for this person, D-035), the error reference when an error page opened
 * it, and whether the board may write back. When the message names students of the person's
 * schools, each name is listed to confirm before anything is sent; other personal details must be
 * removed (the first-name guard, D-066).
 */
export function FeedbackForm({
  userId,
  initialRef,
  onSent,
}: {
  userId: string;
  /** « Référence : … » of the error page that opened the form. */
  initialRef?: string | null;
  onSent?: () => void;
}) {
  const t = useTranslations('feedback');
  const tCommon = useTranslations('common');
  const tBlocked = useTranslations('differentiate.blocked');
  const id = useId();
  const draft = useDraft<Draft>(`feedback:${userId}`, EMPTY);
  const [errorRef, setErrorRef] = useState(initialRef ?? '');
  const [check, setCheck] = useState<{ names: string[]; blocked: string[] } | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const send = useAction(sendFeedback);
  const { kind, message, mayContact } = draft.value;

  const edit = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    draft.update(field, value);
    // The names found were in the old text.
    if (field === 'message') setCheck(null);
  };

  const ready =
    !check || (check.blocked.length === 0 && check.names.every((n) => confirmed.includes(n)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const result = await send.run(
      {
        kind,
        message,
        errorRef: errorRef.trim() || null,
        device: deviceClass(window.innerWidth),
        mayContact,
      },
      confirmed,
    );
    if (!result?.ok) return;
    if (result.data.sent) {
      toast.success(t('sent'));
      draft.discard();
      setErrorRef('');
      setCheck(null);
      setConfirmed([]);
      onSent?.();
    } else {
      const { names, blocked } = result.data;
      setCheck({ names, blocked });
      setConfirmed((prev) => prev.filter((n) => names.includes(n)));
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      {draft.restored ? (
        <Notice className="flex flex-wrap items-center justify-between gap-2">
          <span>{tCommon('draftRestored')}</span>
          <Button variant="ghost" size="sm" onClick={draft.discard}>
            {tCommon('discardDraft')}
          </Button>
        </Notice>
      ) : null}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('kindLegend')}</legend>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <label
              key={k}
              className={cn(
                'relative inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-sm font-medium ring-1 ring-inset has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                kind === k
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-white text-slate-700 ring-slate-300',
              )}
            >
              <input
                type="radio"
                name={`${id}-kind`}
                value={k}
                checked={kind === k}
                onChange={() => edit('kind', k)}
                // Over the whole chip, invisible: the chip is the radio button.
                className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
              />
              {t(`kinds.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        label={t('message')}
        htmlFor={`${id}-message`}
        hint={t('messageHint')}
        error={send.fieldError('message')}
      >
        <Textarea
          id={`${id}-message`}
          value={message}
          maxLength={FEEDBACK_MAX}
          rows={5}
          aria-describedby={`${id}-counter`}
          aria-invalid={send.fieldErrors.message ? true : undefined}
          onChange={(e) => edit('message', e.target.value)}
        />
        <p id={`${id}-counter`} className="text-right text-xs text-slate-500 tabular-nums">
          {t('counter', { count: message.length, max: FEEDBACK_MAX })}
        </p>
      </Field>

      <Field
        label={t('reference')}
        htmlFor={`${id}-ref`}
        hint={t('referenceHint')}
        error={send.fieldError('errorRef')}
      >
        <Input
          id={`${id}-ref`}
          value={errorRef}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={send.fieldErrors.errorRef ? true : undefined}
          onChange={(e) => setErrorRef(e.target.value)}
        />
      </Field>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="size-5"
          checked={mayContact}
          onChange={(e) => edit('mayContact', e.target.checked)}
        />
        {t('mayContact')}
      </label>

      {check ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {check.blocked.length ? (
            <div role="alert">
              <p>{t('names.blocked')}</p>
              <ul className="mt-1 list-disc pl-5">
                {check.blocked.map((k) => (
                  <li key={k}>{tBlocked.has(k as 'email') ? tBlocked(k as 'email') : k}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {check.names.length ? (
            <fieldset className="space-y-1">
              <legend>{t('names.intro', { names: check.names.join(', ') })}</legend>
              {check.names.map((name) => (
                <label key={name} className="flex min-h-11 cursor-pointer items-center gap-2">
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
                  {t('names.confirm', { name })}
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={send.pending || !ready}>
          {send.pending ? t('sending') : t('send')}
        </Button>
      </div>
    </form>
  );
}
