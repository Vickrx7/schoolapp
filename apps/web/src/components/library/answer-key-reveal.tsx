'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * « Afficher le corrigé »: the answer key stays collapsed (screens are projected in class) until
 * the teacher asks; collapsed, it is not on the page at all. A button with `aria-expanded`.
 */
export function AnswerKeyReveal({ children }: { children: ReactNode }) {
  const t = useTranslations('libraryItem');
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3 border-t border-slate-200 pt-4 print:hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {open ? t('hideKey') : t('showKey')}
        </Button>
        {open ? null : <p className="text-sm text-slate-600">{t('keyHint')}</p>}
      </div>
      <div id={id}>{open ? children : null}</div>
    </div>
  );
}
