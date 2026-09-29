'use client';

import { frenchStrings, suggestsFaithContent } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/field';
import type { EditorContext } from '@/server/library/editor-context';
import type { LibraryEditorForm } from '@/server/library/editor-form';
import { fieldId, useEditorErrors } from './editor-errors';
import type { FormPatch } from './meta-fields';

/**
 * « Foi » (SPEC 9.5, D-064, D-074): « Contient du contenu de foi », suggested when the text holds
 * faith words (prière, Dieu, évangile…), the link with the faith (a Catholic reference of the
 * board and a short text) and whether it is printed on the student sheet. Faith content is
 * reviewed by the board's designated person before it reaches the whole board; a flag set by a
 * reviewer stays.
 */
export function FaithFields({
  form,
  patch,
  context,
  flaggedByReviewer,
}: {
  form: LibraryEditorForm;
  patch: FormPatch;
  context: EditorContext;
  flaggedByReviewer: boolean;
}) {
  const t = useTranslations('libraryEdit.faith');
  const errors = useEditorErrors();
  const reflection = form.type === 'catholic_reflection';
  const locked = flaggedByReviewer || reflection;
  const suggested = useMemo(
    () =>
      !form.faithContent &&
      [
        form.title,
        form.summary,
        ...form.versions.flatMap((v) => frenchStrings(form.type, v.content)),
        ...form.versions.map((v) => v.solution),
      ].some((text) => suggestsFaithContent(text)),
    [form.faithContent, form.title, form.summary, form.versions, form.type],
  );
  const grades = context.grades.filter((g) => form.gradeCodes.includes(g.code));
  // References for the item's grades first; the others stay available.
  const references = [...context.references].sort(
    (a, b) =>
      Number(!grades.some((g) => a.gradeMin <= g.ordinal && a.gradeMax >= g.ordinal)) -
      Number(!grades.some((g) => b.gradeMin <= g.ordinal && b.gradeMax >= g.ordinal)),
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            className="size-5"
            checked={form.faithContent || locked}
            disabled={locked}
            onChange={(e) => patch({ faithContent: e.target.checked })}
          />
          {t('content')}
        </label>
        {flaggedByReviewer ? (
          <p className="text-sm text-slate-600">{t('flagged')}</p>
        ) : reflection ? (
          <p className="text-sm text-slate-600">{t('reflection')}</p>
        ) : null}
      </div>
      {suggested && !locked ? (
        <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('suggested')}</span>
          <Button variant="secondary" onClick={() => patch({ faithContent: true })}>
            {t('tick')}
          </Button>
        </Notice>
      ) : null}

      <Field
        label={t('reference')}
        htmlFor={fieldId('catholicReferenceId')}
        hint={t('referenceHint')}
        error={errors.at('catholicReferenceId')}
      >
        <Select
          id={fieldId('catholicReferenceId')}
          value={form.catholicReferenceId ?? ''}
          onChange={(e) => patch({ catholicReferenceId: e.target.value || null })}
        >
          <option value="">{t('noReference')}</option>
          {references.map((r) => (
            <option key={r.id} value={r.id}>
              {t('referenceOption', { title: r.title, type: t(`referenceTypes.${r.type}`) })}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('connection')}
        htmlFor={fieldId('catholicConnection')}
        hint={t('connectionHint')}
        error={errors.at('catholicConnection')}
      >
        <Textarea
          id={fieldId('catholicConnection')}
          lang="fr-CA"
          value={form.catholicConnection}
          maxLength={2000}
          className="min-h-16"
          onChange={(e) => patch({ catholicConnection: e.target.value })}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="size-5"
          checked={form.faithOnStudentSheet}
          onChange={(e) => patch({ faithOnStudentSheet: e.target.checked })}
        />
        {t('onStudentSheet')}
      </label>
      <p className="text-sm text-slate-500">{t('reviewHint')}</p>
    </div>
  );
}
