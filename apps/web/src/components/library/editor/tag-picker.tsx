'use client';

import { useTranslations } from 'next-intl';
import { Chip } from '@/components/ui/chip';
import { Field, Input } from '@/components/ui/field';
import type { LibraryEditorForm } from '@/server/library/editor-form';
import { fieldId, useEditorErrors } from './editor-errors';
import type { FormPatch } from './meta-fields';

const MAX_TAGS = 10;

/**
 * « Étiquettes et mots-clés » (D-067): the curated tags as chips (up to 10), then free keywords,
 * which only the people who can read the item see until it is shared.
 */
export function TagPicker({
  form,
  patch,
  tags,
}: {
  form: LibraryEditorForm;
  patch: FormPatch;
  tags: { id: string; label: string }[];
}) {
  const t = useTranslations('libraryEdit.fields');
  const errors = useEditorErrors();
  const chosen = new Set(form.tagIds);
  const tagError = errors.at('tagIds') ?? errors.at('readiness.tags');
  return (
    <div className="space-y-3">
      {tags.length ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">
            {t('tags', { count: form.tagIds.length, max: MAX_TAGS })}
          </legend>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Chip
                key={tag.id}
                type="checkbox"
                name="tags"
                value={tag.id}
                checked={chosen.has(tag.id)}
                disabled={!chosen.has(tag.id) && form.tagIds.length >= MAX_TAGS}
                onChange={() =>
                  patch({
                    tagIds: chosen.has(tag.id)
                      ? form.tagIds.filter((id) => id !== tag.id)
                      : [...form.tagIds, tag.id],
                  })
                }
              >
                {tag.label}
              </Chip>
            ))}
          </div>
          {tagError ? (
            <p className="text-sm text-red-600" role="alert">
              {tagError}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      <Field
        label={t('keywords')}
        htmlFor={fieldId('keywords')}
        hint={t('keywordsHint')}
        error={errors.at('keywords')}
      >
        <Input
          id={fieldId('keywords')}
          lang="fr-CA"
          value={form.keywords}
          maxLength={300}
          onChange={(e) => patch({ keywords: e.target.value })}
        />
      </Field>
    </div>
  );
}
