'use client';

import { ACHIEVEMENT_CATEGORIES, type AchievementCategory } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { fieldId, useEditorErrors } from './editor-errors';
import { AddButton, ItemControls } from './list-controls';
import { move, removeAt } from './question-ops';

export interface RubricCriterion {
  category: AchievementCategory;
  criterion: string;
  levels: { level1: string; level2: string; level3: string; level4: string };
}

const LEVELS = ['level1', 'level2', 'level3', 'level4'] as const;

/**
 * « Grille d'évaluation » (SPEC 9.3): one row per criterion, with its category of the
 * achievement chart and what each level 1 to 4 looks like. A table that scrolls on its own on a
 * phone, with a caption, so the page itself never scrolls sideways (D-034).
 */
export function RubricEditor({
  label,
  criteria,
  onChange,
  path,
  min = 4,
  max = 16,
}: {
  label: string;
  criteria: RubricCriterion[];
  onChange: (criteria: RubricCriterion[]) => void;
  path: string;
  min?: number;
  max?: number;
}) {
  const t = useTranslations('libraryEdit.rubric');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const listError = errors.at(path);
  const change = (i: number, next: RubricCriterion) =>
    onChange(criteria.map((c, j) => (j === i ? next : c)));

  return (
    <div className="space-y-3">
      <div
        className="overflow-x-auto rounded-lg border border-slate-200"
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <table className="w-full min-w-[56rem] border-collapse text-sm" lang="fr-CA">
          <caption className="px-3 py-2 text-left font-medium text-slate-700">
            {label} — {t('caption')}
          </caption>
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th scope="col" className="w-40 px-2 py-2 font-medium">
                {t('category')}
              </th>
              <th scope="col" className="w-44 px-2 py-2 font-medium">
                {t('criterion')}
              </th>
              {LEVELS.map((level, i) => (
                <th key={level} scope="col" className="px-2 py-2 font-medium">
                  {t('level', { n: i + 1 })}
                </th>
              ))}
              <th scope="col" className="px-2 py-2">
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c, i) => {
              const rowPath = `${path}.${i}`;
              const name = t('row', { n: i + 1 });
              return (
                <tr
                  key={i}
                  className={cn(
                    'border-t border-slate-200 align-top',
                    errors.within(rowPath) && 'bg-red-50',
                  )}
                >
                  <td className="px-2 py-2">
                    <Select
                      id={fieldId(`${rowPath}.category`)}
                      aria-label={t('categoryOf', { name })}
                      value={c.category}
                      onChange={(e) =>
                        change(i, { ...c, category: e.target.value as AchievementCategory })
                      }
                    >
                      {ACHIEVEMENT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {tc(`categories.${cat}`)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      id={fieldId(`${rowPath}.criterion`)}
                      aria-label={t('criterionOf', { name })}
                      aria-invalid={errors.at(`${rowPath}.criterion`) ? true : undefined}
                      value={c.criterion}
                      maxLength={300}
                      onChange={(e) => change(i, { ...c, criterion: e.target.value })}
                    />
                  </td>
                  {LEVELS.map((level, l) => (
                    <td key={level} className="px-2 py-2">
                      <Textarea
                        id={fieldId(`${rowPath}.levels.${level}`)}
                        aria-label={t('levelOf', { name, n: l + 1 })}
                        aria-invalid={errors.at(`${rowPath}.levels.${level}`) ? true : undefined}
                        value={c.levels[level]}
                        maxLength={500}
                        className="min-h-20"
                        onChange={(e) =>
                          change(i, { ...c, levels: { ...c.levels, [level]: e.target.value } })
                        }
                      />
                    </td>
                  ))}
                  <td className="px-1 py-2">
                    <ItemControls
                      name={name}
                      index={i}
                      count={criteria.length}
                      onMove={(direction) => onChange(move(criteria, i, direction))}
                      onRemove={() => onChange(removeAt(criteria, i))}
                      canRemove={criteria.length > min}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {criteria.some((_, i) => errors.within(`${path}.${i}`)) ? (
        <ul className="space-y-1 text-sm text-red-600" role="alert">
          {criteria.flatMap((_, i) =>
            ['category', 'criterion', ...LEVELS.map((l) => `levels.${l}`)].flatMap((field) => {
              const message = errors.at(`${path}.${i}.${field}`);
              return message
                ? [<li key={`${i}.${field}`}>{t('rowError', { n: i + 1, message })}</li>]
                : [];
            }),
          )}
        </ul>
      ) : null}
      <p className="text-sm text-slate-600">{t('hint')}</p>
      <AddButton
        label={t('add')}
        count={criteria.length}
        min={min}
        max={max}
        onAdd={() =>
          onChange([
            ...criteria,
            {
              category: 'connaissance',
              criterion: '',
              levels: { level1: '', level2: '', level3: '', level4: '' },
            },
          ])
        }
      />
      {listError ? (
        <p className="text-sm text-red-600" role="alert">
          {listError}
        </p>
      ) : null}
    </div>
  );
}
