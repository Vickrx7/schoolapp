'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export interface VersionChoice {
  id: string;
  /** « Version de base » or the level's name: on screen for staff only (D-042). */
  label: string;
}

/**
 * « Version de base · Débutant · Intermédiaire · Avancé · Enrichi »: one pressed button per
 * version (a labelled group, `aria-pressed`), scrolling sideways on a phone rather than the page.
 */
export function VersionPicker({
  versions,
  selected,
  onSelect,
}: {
  versions: readonly VersionChoice[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('libraryItem.versions');
  if (versions.length <= 1) return null;
  return (
    <div className="space-y-1">
      <div
        role="group"
        aria-label={t('label')}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
      >
        {versions.map((v) => (
          <Button
            key={v.id}
            variant={v.id === selected ? 'primary' : 'secondary'}
            aria-pressed={v.id === selected}
            onClick={() => onSelect(v.id)}
            className="shrink-0 rounded-full"
          >
            {v.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-slate-600">{t('hint')}</p>
    </div>
  );
}
