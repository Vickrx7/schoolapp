'use client';

import { englishState, type NewsletterItem } from '@lynx/domain';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { EnglishStatus } from './english-status';

/**
 * Rows for a text box where the browser cannot size it to its content (`field-sizing`): its
 * lines, at least two, at most eight.
 */
const rowsFor = (text: string) =>
  Math.min(
    8,
    Math.max(
      2,
      text.split('\n').reduce((n, line) => n + Math.ceil((line.length + 1) / 55), 0),
    ),
  );

/**
 * One paragraph (DECISIONS D-137): « Français » and « English » side by side from `md:`, one at a
 * time on phones (the section's « Français · English »), how its English stands, and « Monter »,
 * « Descendre », « Retirer » (44 px targets).
 */
export function ItemRow({
  item,
  index,
  count,
  lang,
  readOnly,
  onFrench,
  onEnglish,
  onMove,
  onRemove,
}: {
  item: NewsletterItem;
  /** Its place in the section, from 0. */
  index: number;
  count: number;
  /** The language shown on phones. */
  lang: 'fr' | 'en';
  readOnly: boolean;
  onFrench: (fr: string) => void;
  onEnglish: (en: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('newsletter.editor');
  const n = index + 1;
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3" data-testid="newsletter-item">
      <p className="sr-only">{t('paragraph', { n })}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className={cn('space-y-1', lang === 'en' && 'hidden md:block')}>
          <Label htmlFor={`${item.id}-fr`}>{t('frenchLabel')}</Label>
          <Textarea
            id={`${item.id}-fr`}
            lang="fr"
            value={item.fr}
            rows={rowsFor(item.fr)}
            className="min-h-16 [field-sizing:content]"
            readOnly={readOnly}
            placeholder={item.from.kind === 'typed' ? t('placeholder') : undefined}
            onChange={(e) => onFrench(e.target.value)}
          />
        </div>
        <div className={cn('space-y-1', lang === 'fr' && 'hidden md:block')}>
          <Label htmlFor={`${item.id}-en`}>{t('englishLabel')}</Label>
          <Textarea
            id={`${item.id}-en`}
            lang="en"
            value={item.en}
            rows={rowsFor(item.en || item.fr)}
            className="min-h-16 [field-sizing:content]"
            readOnly={readOnly}
            onChange={(e) => onEnglish(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <EnglishStatus state={englishState(item)} />
        {readOnly ? null : (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('moveUp', { n })}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('moveDown', { n })}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('remove', { n })} onClick={onRemove}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
