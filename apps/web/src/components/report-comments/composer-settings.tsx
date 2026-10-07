'use client';

import { COMMENT_LIMIT_MAX, COMMENT_LIMIT_MIN } from '@lynx/domain';
import { Printer, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

/**
 * « Réglages et impression » (DECISIONS D-130): « Limite de caractères » and « Espaces simples à
 * la copie » for this class and period (device only), « Imprimer tous les commentaires » (the
 * browser's print, one student per page), and « Effacer mes commentaires de cette période sur
 * cet appareil ». No form: nothing here is sent.
 */
export function ComposerSettings({
  limit,
  plainSpaces,
  onLimit,
  onPlainSpaces,
  printable,
  onPrintAll,
  studentsWithWork,
  onClearAll,
}: {
  limit: number;
  plainSpaces: boolean;
  onLimit: (limit: number) => void;
  onPlainSpaces: (on: boolean) => void;
  /** Students with a comment in the chosen subject. */
  printable: number;
  onPrintAll: () => void;
  studentsWithWork: number;
  onClearAll: () => void;
}) {
  const t = useTranslations('reportComments.settings');
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) onLimit(Math.min(COMMENT_LIMIT_MAX, Math.max(COMMENT_LIMIT_MIN, n)));
    setTyped(null);
  };
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 id={`${id}-heading`} className="text-base font-semibold text-slate-900">
        {t('heading')}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-limit`}>{t('limit')}</Label>
          <Input
            id={`${id}-limit`}
            type="number"
            inputMode="numeric"
            min={COMMENT_LIMIT_MIN}
            max={COMMENT_LIMIT_MAX}
            step={50}
            className="max-w-40"
            value={typed ?? String(limit)}
            aria-describedby={`${id}-limit-hint`}
            onChange={(e) => {
              setTyped(e.target.value);
              const n = Number.parseInt(e.target.value, 10);
              if (n >= COMMENT_LIMIT_MIN && n <= COMMENT_LIMIT_MAX) onLimit(n);
            }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
            }}
          />
          <p id={`${id}-limit-hint`} className="text-sm text-slate-600">
            {t('limitHint')}
          </p>
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 self-start pt-6 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-brand-600"
            checked={plainSpaces}
            onChange={(e) => onPlainSpaces(e.target.checked)}
          />
          <span>{t('plainSpaces')}</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onPrintAll} disabled={printable === 0}>
          <Printer aria-hidden />
          {t('printAll', { count: printable })}
        </Button>
        <ConfirmButton
          label={t('clearAll')}
          message={t('clearAllMessage', { count: studentsWithWork })}
          confirmLabel={t('clearAllConfirm')}
          size="md"
          variant="ghost"
          disabled={studentsWithWork === 0}
          onConfirm={() => {
            onClearAll();
            toast.success(t('cleared'));
          }}
        >
          <Trash2 aria-hidden />
          <span>{t('clearAll')}</span>
        </ConfirmButton>
      </div>
    </section>
  );
}
