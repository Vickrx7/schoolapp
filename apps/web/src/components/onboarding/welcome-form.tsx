'use client';

import type { CURRENT_TERMS_VERSION, TermsState } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { acceptTerms } from '@/server/actions/onboarding';

/** How students address a teacher, as substitute plans print it (« Mme Tremblay »). */
const HONORIFICS = ['Mme', 'M.', 'Mx'];

const POINTS = ['firstNames', 'alerts', 'ai', 'canada', 'feedback'] as const;

const subscribeNothing = () => () => {};

/**
 * « Bienvenue » (DECISIONS D-109, D-110): the privacy points and the pilot terms with their
 * checkbox, then, at a first sign-in, the profile (« Nom affiché », « Comment les élèves vous
 * appellent-ils? »), kept as a draft on this device for this person. When newer terms come out
 * (`mode="outdated"`), the terms alone.
 *
 * The inputs are uncontrolled and read when the form is sent, and « Commencer » waits for the
 * page to be ready: what is ticked or chosen before then is kept, and the form never sends itself
 * the browser's way (which would put the profile in the address).
 */
export function WelcomeForm({
  mode,
  userId,
  version,
  displayName,
  honorific,
  next,
}: {
  mode: Exclude<TermsState, 'accepted'>;
  userId: string;
  /** The terms shown (`CURRENT_TERMS_VERSION`): accepting is accepting that text. */
  version: typeof CURRENT_TERMS_VERSION;
  displayName: string;
  honorific: string | null;
  next: string | null;
}) {
  const t = useTranslations('welcome');
  const tCommon = useTranslations('common');
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const draft = useDraft(`welcome:${userId}`, { displayName, honorific: honorific ?? '' });
  const [acceptError, setAcceptError] = useState(false);
  const accept = useAction(acceptTerms, {
    onSuccess: ({ next: target }) => {
      draft.clear();
      // A full load: every part of the app reads the session again.
      window.location.assign(target);
    },
  });
  const honorifics =
    HONORIFICS.includes(draft.value.honorific) || !draft.value.honorific
      ? HONORIFICS
      : [draft.value.honorific, ...HONORIFICS];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = new FormData(form.current!);
    if (data.get('accept') !== 'on') {
      setAcceptError(true);
      return;
    }
    setAcceptError(false);
    void accept.run({
      version,
      next,
      profile:
        mode === 'required'
          ? {
              displayName: String(data.get('displayName') ?? ''),
              honorific: String(data.get('honorific') ?? ''),
            }
          : undefined,
    });
  };

  return (
    <form ref={form} onSubmit={submit} className="space-y-6" noValidate>
      <section aria-labelledby={`${id}-privacy`} className="space-y-3">
        <h2 id={`${id}-privacy`} className="text-lg font-semibold text-slate-900">
          {t('privacyHeading')}
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-slate-800">
          {POINTS.map((point) => (
            <li key={point}>{t(`points.${point}`)}</li>
          ))}
        </ul>
        <p>
          <Link
            href="/confidentialite"
            className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-2"
          >
            {t('readTerms')}
          </Link>
        </p>
        <div className="space-y-1">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 bg-white p-3 text-slate-900">
            <input
              type="checkbox"
              name="accept"
              className="mt-0.5 size-5 shrink-0"
              aria-invalid={acceptError || undefined}
              aria-describedby={acceptError ? `${id}-accept-error` : undefined}
              onChange={() => setAcceptError(false)}
            />
            <span className="font-medium">{t('accept')}</span>
          </label>
          {acceptError ? (
            <p id={`${id}-accept-error`} role="alert" className="text-sm text-red-600">
              {t('acceptRequired')}
            </p>
          ) : null}
        </div>
      </section>

      {mode === 'required' ? (
        <section
          aria-labelledby={`${id}-profile`}
          className="space-y-3"
          // A restored draft fills the fields again.
          key={draft.restored ? 'restored' : 'initial'}
        >
          <h2 id={`${id}-profile`} className="text-lg font-semibold text-slate-900">
            {t('profileHeading')}
          </h2>
          {draft.restored ? (
            <p className="text-sm text-slate-600">{tCommon('draftRestored')}</p>
          ) : null}
          <Field
            label={t('displayName')}
            htmlFor={`${id}-name`}
            error={accept.fieldError('profile.displayName')}
          >
            <Input
              id={`${id}-name`}
              name="displayName"
              defaultValue={draft.value.displayName}
              maxLength={120}
              autoComplete="name"
              onChange={(e) => draft.update('displayName', e.target.value)}
            />
          </Field>
          <Field
            label={t('honorific')}
            htmlFor={`${id}-honorific`}
            hint={t('honorificHint')}
            error={accept.fieldError('profile.honorific')}
          >
            <Select
              id={`${id}-honorific`}
              name="honorific"
              defaultValue={draft.value.honorific}
              onChange={(e) => draft.update('honorific', e.target.value)}
            >
              {honorifics.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
              <option value="">{t('honorificNone')}</option>
            </Select>
          </Field>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{t('version', { version })}</p>
        <Button type="submit" size="lg" disabled={!hydrated || accept.pending}>
          {mode === 'required' ? t('start') : t('acceptUpdated')}
        </Button>
      </div>
    </form>
  );
}
