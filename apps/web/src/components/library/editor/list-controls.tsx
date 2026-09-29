'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { Direction } from './question-ops';

/**
 * Move and remove buttons for one element of a list in the editor. Icon buttons are 44 px
 * (D-034) and name the element they act on (« Retirer l'élément 3 »). After a move the focus
 * stays on the moved element's button (its other move button once it reaches an end), so a
 * keyboard user can keep moving it: the list's rows have stable keys, and the browser drops the
 * focus of an element the page moves.
 */
export function ItemControls({
  name,
  index,
  count,
  onMove,
  onRemove,
  canRemove = true,
}: {
  /** « Étape 2 », « Question 3 »: what the buttons act on. */
  name: string;
  index: number;
  count: number;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
  canRemove?: boolean;
}) {
  const t = useTranslations('libraryEdit.list');
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const moveKeepingFocus = (direction: Direction) => {
    onMove(direction);
    requestAnimationFrame(() => {
      const [same, other] = direction === 'up' ? [up, down] : [down, up];
      const next = same.current && !same.current.disabled ? same.current : other.current;
      if (next?.isConnected && !next.disabled && document.activeElement !== next) next.focus();
    });
  };
  return (
    <div className="flex shrink-0 items-center">
      <Button
        ref={up}
        variant="ghost"
        size="icon"
        aria-label={t('moveUp', { name })}
        disabled={index === 0}
        onClick={() => moveKeepingFocus('up')}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        ref={down}
        variant="ghost"
        size="icon"
        aria-label={t('moveDown', { name })}
        disabled={index === count - 1}
        onClick={() => moveKeepingFocus('down')}
      >
        <ArrowDown aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('remove', { name })}
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

/** « Ajouter » under a list, with how many it holds and how many it needs. */
export function AddButton({
  label,
  count,
  min,
  max,
  onAdd,
}: {
  label: string;
  count: number;
  min: number;
  max: number;
  onAdd: () => void;
}) {
  const t = useTranslations('libraryEdit.list');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="md" disabled={count >= max} onClick={onAdd}>
        <Plus aria-hidden />
        {label}
      </Button>
      {Number.isFinite(max) ? (
        <span className="text-sm text-slate-600 tabular-nums">
          {count < min ? t('needed', { min, count }) : t('count', { count, max })}
        </span>
      ) : null}
    </div>
  );
}
