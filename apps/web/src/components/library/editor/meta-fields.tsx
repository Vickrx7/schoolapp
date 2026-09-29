'use client';

import { TYPE_INFO, subFriendlyAllowed } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import type { EditorContext } from '@/server/library/editor-context';
import type { LibraryEditorForm } from '@/server/library/editor-form';
import { fieldId, useEditorErrors } from './editor-errors';
import { TagPicker } from './tag-picker';

/** What « Aucun matériel particulier » writes: materials are content, in French. */
export const NO_MATERIALS_FR = 'Aucun matériel particulier';

export type FormPatch = (changes: Partial<LibraryEditorForm>) => void;

/**
 * « À propos »: title, summary, the school a new resource is written for, duration, materials
 * (with « Aucun matériel particulier »), formats, « Conçue pour une personne suppléante »
 * (refused for assessments, guides and projects, and for experiments without standard
 * supervision, D-077), licence, tags and keywords.
 */
export function MetaFields({
  form,
  patch,
  context,
  isNew,
}: {
  form: LibraryEditorForm;
  patch: FormPatch;
  context: EditorContext;
  isNew: boolean;
}) {
  const t = useTranslations('libraryEdit.fields');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const info = TYPE_INFO[form.type];
  const subAllowed = subFriendlyAllowed(form.type, form.safetyNotes);
  const subHint = !info.subFriendlyAllowed
    ? t('subFriendlyNever')
    : !subAllowed
      ? t('subFriendlySupervision')
      : t('subFriendlyHint');

  return (
    <div className="space-y-4">
      <Field label={t('title')} htmlFor={fieldId('title')} error={errors.at('title')}>
        <Input
          id={fieldId('title')}
          lang="fr-CA"
          value={form.title}
          maxLength={200}
          required
          aria-invalid={errors.at('title') ? true : undefined}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>
      <Field
        label={t('summary')}
        htmlFor={fieldId('summary')}
        hint={t('summaryHint')}
        error={errors.at('summary')}
      >
        <Textarea
          id={fieldId('summary')}
          lang="fr-CA"
          value={form.summary}
          maxLength={1000}
          className="min-h-16"
          onChange={(e) => patch({ summary: e.target.value })}
        />
      </Field>
      {isNew && context.schools.length > 1 ? (
        <Field label={t('school')} htmlFor={fieldId('schoolId')} hint={t('schoolHint')}>
          <Select
            id={fieldId('schoolId')}
            value={form.schoolId ?? ''}
            onChange={(e) => {
              const school = context.schools.find((s) => s.id === e.target.value);
              if (school) patch({ schoolId: school.id, boardId: school.boardId });
            }}
          >
            {context.schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field
        label={t('duration')}
        htmlFor={fieldId('durationMinutes')}
        error={errors.at('durationMinutes')}
      >
        <div className="flex items-center gap-2">
          <Input
            id={fieldId('durationMinutes')}
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            className="w-28"
            value={form.durationMinutes ?? ''}
            aria-invalid={errors.at('durationMinutes') ? true : undefined}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const n = raw === '' ? null : Math.round(Number(raw));
              patch({ durationMinutes: n !== null && Number.isFinite(n) ? n : null });
            }}
          />
          <span className="text-sm text-slate-600">{t('minutes')}</span>
        </div>
      </Field>
      <Field
        label={t('materials')}
        htmlFor={fieldId('materials')}
        hint={t('materialsHint')}
        error={errors.at('materials')}
      >
        <Textarea
          id={fieldId('materials')}
          lang="fr-CA"
          value={form.materials}
          maxLength={4000}
          className="min-h-16"
          onChange={(e) => patch({ materials: e.target.value })}
        />
      </Field>
      <Button
        variant="secondary"
        size="md"
        onClick={() => patch({ materials: NO_MATERIALS_FR })}
        disabled={form.materials.trim() === NO_MATERIALS_FR}
      >
        {t('noMaterials')}
      </Button>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-slate-700">{t('formats')}</legend>
        <div className="flex flex-wrap gap-x-5">
          {(
            [
              ['isPrintable', 'printable'],
              ['isProjectable', 'projectable'],
              ['isInteractive', 'interactive'],
            ] as const
          ).map(([field, key]) => (
            <label key={field} className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-5"
                checked={form[field]}
                onChange={(e) => patch({ [field]: e.target.checked })}
              />
              {tc(`formats.${key}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-5"
            checked={form.subFriendly && subAllowed}
            disabled={!subAllowed}
            aria-describedby={fieldId('subFriendly-hint')}
            onChange={(e) => patch({ subFriendly: e.target.checked })}
          />
          {t('subFriendly')}
        </label>
        <p id={fieldId('subFriendly-hint')} className="text-sm text-slate-500">
          {subHint}
        </p>
        {errors.at('subFriendly') ? (
          <p className="text-sm text-red-600" role="alert">
            {errors.at('subFriendly')}
          </p>
        ) : null}
      </div>

      <TagPicker form={form} patch={patch} tags={context.tags} />

      <Field
        label={t('licence')}
        htmlFor={fieldId('licence')}
        hint={t('licenceHint')}
        error={errors.at('licence')}
      >
        <Input
          id={fieldId('licence')}
          value={form.licence}
          maxLength={200}
          onChange={(e) => patch({ licence: e.target.value })}
        />
      </Field>
    </div>
  );
}
