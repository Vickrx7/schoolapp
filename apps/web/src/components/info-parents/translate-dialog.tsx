'use client';

import { Languages, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { SentText } from '@/components/library/generate-preview';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAction } from '@/hooks/use-action';
import {
  previewNewsletterTranslation,
  requestNewsletterTranslation,
  type NewsletterTranslateScope,
} from '@/server/actions/newsletter-ai';
import type { NewsletterTranslatePreview } from '@/server/newsletter/ai-preview';

/**
 * « Traduire en anglais (IA) » (DECISIONS D-139): « Vérifier avant d'envoyer » shows exactly what
 * would be sent (the saved message's paragraphs to translate, names the app knows replaced and
 * highlighted), the paragraphs left out (« Non envoyé — traduisez-le vous-même ») and why, and the
 * capitalized words to check; « Envoyer à l'IA » waits for « J'ai vérifié ». The scope: the
 * paragraphs without an up-to-date English version, or all of them again.
 */
export function TranslateButton({
  newsletterId,
  counts,
  disabled,
  onSent,
}: {
  newsletterId: string;
  /** Paragraphs of the saved message: without up-to-date English, and with French at all. */
  counts: { missing: number; all: number };
  disabled: boolean;
  onSent: () => void;
}) {
  const t = useTranslations('newsletter');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<NewsletterTranslateScope>('missing');
  const [preview, setPreview] = useState<NewsletterTranslatePreview | null>(null);
  const [checked, setChecked] = useState(false);
  const check = useAction(previewNewsletterTranslation, {
    onSuccess: (data) => {
      setPreview(data);
      setChecked(false);
    },
  });
  const send = useAction(requestNewsletterTranslation, {
    onSuccess: () => {
      setOpen(false);
      setPreview(null);
      onSent();
    },
  });

  const load = async (next: NewsletterTranslateScope) => {
    setScope(next);
    setPreview(null);
    const result = await check.run(newsletterId, next);
    if (result && !result.ok) setOpen(false);
  };
  const start = () => {
    setOpen(true);
    void load(counts.missing > 0 ? 'missing' : 'all');
  };
  const submit = async () => {
    if (!preview) return;
    const result = await send.run(newsletterId, scope, preview.revision, preview.sendKeys, checked);
    // The message (or what would be left out) changed since: check it again, in place.
    if (result && !result.ok && result.error === 'newsletterStale') await load(scope);
  };

  const list = (words: string[]) => new Intl.ListFormat(locale, { type: 'unit' }).format(words);
  const nothing = preview !== null && preview.sendKeys.length === 0;

  return (
    <>
      <Button variant="secondary" disabled={disabled || check.pending} onClick={start}>
        <Languages aria-hidden />
        {t('ai.button')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false);
            setPreview(null);
          }
        }}
      >
        <DialogContent
          title={t('ai.previewTitle')}
          description={t('ai.previewIntro')}
          closeLabel={tCommon('close')}
          className="sm:max-w-2xl"
        >
          <div className="space-y-4" data-testid="translate-preview">
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-slate-900">{t('ai.scope')}</legend>
              {(
                [
                  ['missing', t('ai.scopeMissing', { count: counts.missing })],
                  ['all', t('ai.scopeAll', { count: counts.all })],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-3 text-sm text-slate-800"
                >
                  <input
                    type="radio"
                    name={`${id}-scope`}
                    className="size-5 accent-brand-600"
                    checked={scope === value}
                    disabled={check.pending || (value === 'missing' && counts.missing === 0)}
                    onChange={() => void load(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            {preview === null ? (
              <p className="text-sm text-slate-600" role="status">
                {tCommon('loading')}
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-700" role="status" data-testid="translate-count">
                  {t('ai.sentCount', { count: preview.sendKeys.length })}{' '}
                  {nothing ? null : t('ai.replacedCount', { count: preview.replaced })}
                </p>

                {preview.notSent.length ? (
                  <Notice tone="warning" className="space-y-2" data-testid="translate-not-sent">
                    <p className="flex items-center gap-1.5 font-medium">
                      <TriangleAlert className="size-4 shrink-0" aria-hidden />
                      {t('ai.notSentTitle')}
                    </p>
                    <p>{t('ai.notSentIntro')}</p>
                    <ul className="space-y-2">
                      {preview.notSent.map((n) => (
                        <li key={n.key} className="rounded-lg bg-white/70 p-2">
                          <p className="text-slate-900" lang="fr">
                            {n.text}
                          </p>
                          <p className="text-sm">
                            {n.reasons
                              .map((r) =>
                                t('ai.notSentReason', {
                                  kind: t(`ai.kinds.${r.kind}`),
                                  match: r.match,
                                }),
                              )
                              .join(' · ')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </Notice>
                ) : null}

                {nothing ? (
                  <Notice tone="warning">{t('ai.nothingSent')}</Notice>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-900" id={`${id}-sent`}>
                        {t('ai.sentText')}
                      </p>
                      <div aria-labelledby={`${id}-sent`} data-testid="translate-sent">
                        <SentText segments={preview.message} />
                      </div>
                    </div>
                    <Notice
                      tone={preview.words.length ? 'warning' : 'info'}
                      data-testid="translate-words"
                    >
                      <p>
                        {preview.words.length
                          ? t('ai.words', { words: list(preview.words) })
                          : t('ai.noWords')}
                      </p>
                      <p className="mt-1 text-sm">{t('ai.limit')}</p>
                    </Notice>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 bg-white p-3 text-slate-900">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0 accent-brand-600"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      <span>{t('ai.confirm')}</span>
                    </label>
                  </>
                )}
              </>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  setPreview(null);
                }}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                disabled={!preview || nothing || !checked || send.pending || check.pending}
                onClick={() => void submit()}
              >
                {send.pending ? t('ai.sending') : t('ai.send')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
