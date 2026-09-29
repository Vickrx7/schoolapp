'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useEditorErrors } from './editor-errors';
import { AddButton, ItemControls } from './list-controls';
import { move, removeAt } from './question-ops';

/**
 * A list of small records (steps, sections, glossary entries, milestones…): each element is a
 * labelled group (« Étape 2 ») with its own fields, drawn by `renderItem`, and move and remove
 * buttons.
 */
export function ObjectListEditor<T>({
  label,
  itemLabel,
  addLabel,
  items,
  onChange,
  path,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  newItem,
  renderItem,
  hint,
  lang,
}: {
  label: string;
  itemLabel: string;
  /** « Ajouter une étape ». */
  addLabel: string;
  items: T[];
  onChange: (items: T[]) => void;
  path: string;
  min?: number;
  max?: number;
  newItem: () => T;
  renderItem: (item: T, index: number, change: (next: T) => void, itemPath: string) => ReactNode;
  hint?: string;
  lang?: string;
}) {
  const t = useTranslations('libraryEdit.list');
  const errors = useEditorErrors();
  const listError = errors.at(path);
  return (
    <fieldset className="space-y-3" lang={lang}>
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
      {items.length ? (
        <ol className="space-y-3">
          {items.map((item, i) => {
            const name = t('numbered', { label: itemLabel, n: i + 1 });
            const itemPath = `${path}.${i}`;
            return (
              <li key={i}>
                <fieldset
                  className={cn(
                    'space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3',
                    errors.within(itemPath) && 'border-red-300',
                  )}
                >
                  <legend className="sr-only">{name}</legend>
                  <div className="flex items-center justify-between gap-2">
                    <p aria-hidden className="text-sm font-semibold text-slate-800">
                      {name}
                    </p>
                    <ItemControls
                      name={name}
                      index={i}
                      count={items.length}
                      onMove={(direction) => onChange(move(items, i, direction))}
                      onRemove={() => onChange(removeAt(items, i))}
                      canRemove={items.length > min}
                    />
                  </div>
                  {renderItem(
                    item,
                    i,
                    (next) => onChange(items.map((x, j) => (j === i ? next : x))),
                    itemPath,
                  )}
                </fieldset>
              </li>
            );
          })}
        </ol>
      ) : null}
      <AddButton
        label={addLabel}
        count={items.length}
        min={min}
        max={max}
        onAdd={() => onChange([...items, newItem()])}
      />
      {listError ? (
        <p className="text-sm text-red-600" role="alert">
          {listError}
        </p>
      ) : null}
    </fieldset>
  );
}
