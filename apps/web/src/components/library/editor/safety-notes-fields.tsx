'use client';

import { SUPERVISION_LEVELS, emptySafetyNotes, type SafetyNotesDraft } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { Field, Input, Textarea } from '@/components/ui/field';
import { fieldId, useEditorErrors } from './editor-errors';
import { StringListEditor } from './string-list-editor';

/**
 * « Sécurité » for experiments and STEM challenges (SPEC 9.3, D-067): age suitability,
 * allergy-aware materials (nut-free and latex-free alternatives), the supervision level and the
 * hazards. Without them the resource cannot be marked reviewed (`LXL02`), and it can be for a
 * substitute only under « Supervision habituelle » (D-077).
 */
export function SafetyNotesFields({
  notes,
  onChange,
}: {
  notes: SafetyNotesDraft | null;
  onChange: (notes: SafetyNotesDraft) => void;
}) {
  const t = useTranslations('libraryEdit.safety');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const value = notes ?? emptySafetyNotes();
  const set = (changes: Partial<SafetyNotesDraft>) => onChange({ ...value, ...changes });
  const err = (field: string) => errors.at(`safetyNotes.${field}`);
  const missing = errors.at('readiness.safety');

  return (
    <div className="space-y-4" lang="fr-CA">
      <p className="text-sm text-slate-600">{t('intro')}</p>
      {missing ? (
        <p className="text-sm text-red-600" role="alert">
          {missing}
        </p>
      ) : null}
      <Field
        label={t('ageSuitability')}
        htmlFor={fieldId('safetyNotes.ageSuitability')}
        hint={t('ageSuitabilityHint')}
        error={err('ageSuitability')}
      >
        <Input
          id={fieldId('safetyNotes.ageSuitability')}
          value={value.ageSuitability}
          maxLength={300}
          onChange={(e) => set({ ageSuitability: e.target.value })}
        />
      </Field>
      <Field
        label={t('allergyAwareMaterials')}
        htmlFor={fieldId('safetyNotes.allergyAwareMaterials')}
        hint={t('allergyAwareMaterialsHint')}
        error={err('allergyAwareMaterials')}
      >
        <Textarea
          id={fieldId('safetyNotes.allergyAwareMaterials')}
          value={value.allergyAwareMaterials}
          maxLength={600}
          className="min-h-16"
          onChange={(e) => set({ allergyAwareMaterials: e.target.value })}
        />
      </Field>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-slate-700">{t('supervision')}</legend>
        <p className="text-sm text-slate-500">{t('supervisionHint')}</p>
        {SUPERVISION_LEVELS.map((level) => (
          <label
            key={level}
            className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700"
          >
            <input
              type="radio"
              name="supervision"
              className="size-5"
              checked={value.supervision === level}
              onChange={() => set({ supervision: level })}
            />
            {tc(`supervision.${level}`)}
          </label>
        ))}
        {err('supervision') ? (
          <p className="text-sm text-red-600" role="alert">
            {err('supervision')}
          </p>
        ) : null}
      </fieldset>
      <StringListEditor
        label={t('hazards')}
        itemLabel={t('hazard')}
        addLabel={t('addHazard')}
        items={value.hazards}
        onChange={(hazards) => set({ hazards })}
        path="safetyNotes.hazards"
        max={10}
        maxLength={300}
      />
      <Field label={t('notes')} htmlFor={fieldId('safetyNotes.notes')} error={err('notes')}>
        <Textarea
          id={fieldId('safetyNotes.notes')}
          value={value.notes}
          maxLength={1000}
          className="min-h-16"
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
    </div>
  );
}
