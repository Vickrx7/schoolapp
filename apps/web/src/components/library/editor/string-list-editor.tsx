'use client';

import { useTranslations } from 'next-intl';
import { Input, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { fieldId, useEditorErrors } from './editor-errors';
import { AddButton, ItemControls } from './list-controls';
import { move, removeAt, replaceAt } from './question-ops';

/**
 * A list of short texts (success criteria, steps, hints…): one field per element, each with its
 * own label (« Critère 2 »), move and remove buttons, and « Ajouter » up to the schema's maximum.
 */
export function StringListEditor({
  label,
  itemLabel,
  addLabel,
  items,
  onChange,
  path,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  maxLength,
  multiline = false,
  lang,
  hint,
}: {
  label: string;
  /** « Élément », used as « Élément 3 ». */
  itemLabel?: string;
  /** « Ajouter un critère ». */
  addLabel?: string;
  items: string[];
  onChange: (items: string[]) => void;
  /** Editor path of the list (`versions.0.content.successCriteria`). */
  path: string;
  min?: number;
  max?: number;
  maxLength?: number;
  multiline?: boolean;
  lang?: string;
  hint?: string;
}) {
  const t = useTranslations('libraryEdit.list');
  const errors = useEditorErrors();
  const one = itemLabel ?? t('item');
  const listError = errors.at(path);
  return (
    <fieldset className="space-y-2" lang={lang}>
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
      {items.length ? (
        <ol className="space-y-2">
          {items.map((text, i) => {
            const name = t('numbered', { label: one, n: i + 1 });
            const itemPath = `${path}.${i}`;
            const error = errors.at(itemPath);
            const Control = multiline ? Textarea : Input;
            return (
              <li key={i} className="flex items-start gap-1">
                <div className="min-w-0 flex-1 space-y-1">
                  <Control
                    id={fieldId(itemPath)}
                    aria-label={name}
                    aria-invalid={error ? true : undefined}
                    value={text}
                    maxLength={maxLength}
                    className={cn(multiline && 'min-h-16')}
                    onChange={(e) => onChange(replaceAt(items, i, e.target.value))}
                  />
                  {error ? (
                    <p className="text-sm text-red-600" role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
                <ItemControls
                  name={name}
                  index={i}
                  count={items.length}
                  onMove={(direction) => onChange(move(items, i, direction))}
                  onRemove={() => onChange(removeAt(items, i))}
                />
              </li>
            );
          })}
        </ol>
      ) : null}
      <AddButton
        label={addLabel ?? t('addDefault')}
        count={items.length}
        min={min}
        max={max}
        onAdd={() => onChange([...items, ''])}
      />
      {listError ? (
        <p className="text-sm text-red-600" role="alert">
          {listError}
        </p>
      ) : null}
    </fieldset>
  );
}
