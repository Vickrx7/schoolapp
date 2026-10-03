'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { NewsletterNames } from '@/server/newsletter/names';

/** Whether a share needs the check first: students named, a detail found, or English missing. */
export function needsCheck(names: NewsletterNames, missingEnglish: number): boolean {
  return names.studentNames.length > 0 || names.details.length > 0 || missingEnglish > 0;
}

/**
 * « Des élèves sont nommés » (DECISIONS D-138), before the message is copied or marked sent: the
 * class's students it names and the personal details it holds, since it goes to every family;
 * and, before the English is copied, how many paragraphs will appear in French. Nothing blocks
 * and nothing is stored: « Continuer » or « Revenir au message ».
 */
export function CheckDialog({
  open,
  names,
  missingEnglish,
  onContinue,
  onClose,
}: {
  open: boolean;
  names: NewsletterNames;
  /** Paragraphs without an up-to-date English version (0 for the French alone, or marking sent). */
  missingEnglish: number;
  onContinue: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('newsletter');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const named = names.studentNames.length > 0;
  const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format(names.studentNames);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent
        title={named ? t('names.title') : t('names.detailsTitle')}
        closeLabel={tCommon('close')}
      >
        <div className="space-y-3 text-slate-700">
          {named ? <p>{t('names.body', { names: list })}</p> : null}
          {names.details.map((d) => (
            <Notice key={`${d.kind}:${d.match}`} tone="warning">
              {t('names.detail', { kind: t(`names.kinds.${d.kind}`), match: d.match })}
            </Notice>
          ))}
          {missingEnglish > 0 ? (
            <Notice tone="warning">{t('editor.missingEnglish', { count: missingEnglish })}</Notice>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('names.back')}
          </Button>
          <Button onClick={onContinue}>{t('names.continue')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
