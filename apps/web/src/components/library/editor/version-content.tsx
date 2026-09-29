'use client';

import { EDITOR_SPEC, solutionLabelKey } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/field';
import type { EditorVersion, LibraryEditorForm } from '@/server/library/editor-form';
import { ContentFields } from './content-fields';
import { fieldId, useEditorErrors } from './editor-errors';
import { questionIdsOf } from './question-ops';

/**
 * The content of one version in the editor: the type's fields (`EDITOR_SPEC`) and, for types
 * that may carry one, the solution kept with the answer key (a worked solution, an experiment's
 * expected results, a challenge's solution: never on the student sheet).
 */
export function VersionContent({
  form,
  index,
  onChange,
  subjectCode,
}: {
  form: LibraryEditorForm;
  index: number;
  onChange: (version: EditorVersion) => void;
  subjectCode: string | null;
}) {
  const t = useTranslations('libraryEdit');
  const errors = useEditorErrors();
  const version = form.versions[index];
  if (!version) return null;
  const solutionKey = solutionLabelKey(form.type);
  const solutionPath = `versions.${index}.solution`;
  return (
    <div className="space-y-4">
      <ContentFields
        type={form.type}
        specs={EDITOR_SPEC[form.type]}
        value={version.content}
        onChange={(content) => onChange({ ...version, content })}
        path={`versions.${index}.content`}
        limitsPath=""
        subjectCode={subjectCode}
        questionIds={() => questionIdsOf(form.type, version.content)}
      />
      {errors.at(`versions.${index}.content`) ? (
        <p className="text-sm text-red-600" role="alert">
          {errors.at(`versions.${index}.content`)}
        </p>
      ) : null}
      {solutionKey ? (
        <Field
          label={
            <span className="inline-flex flex-wrap items-center gap-2">
              {t(solutionKey as 'content.solution.default')}
              <Badge tone="warning">{t('keyOnly')}</Badge>
            </span>
          }
          htmlFor={fieldId(solutionPath)}
          hint={t('solutionHint')}
          error={errors.at(solutionPath)}
        >
          <Textarea
            id={fieldId(solutionPath)}
            lang="fr-CA"
            value={version.solution}
            maxLength={8000}
            className="min-h-24"
            onChange={(e) => onChange({ ...version, solution: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}
