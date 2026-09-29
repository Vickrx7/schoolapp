'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { Direction } from './question-ops';

/**
 * Move and remove buttons for one element of a list in the editor. Icon buttons are 44 px
 * (D-034) and name the element they act on (« Retirer l'élément 3 »).
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
  return (
    <div className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('moveUp', { name })}
        disabled={index === 0}
        onClick={() => onMove('up')}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('moveDown', { name })}
        disabled={index === count - 1}
        onClick={() => onMove('down')}
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
