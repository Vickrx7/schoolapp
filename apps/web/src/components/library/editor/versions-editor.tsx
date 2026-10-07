'use client';

import { fromAuthoring, renderStudentDoc } from '@lynx/content';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { EditorContext } from '@/server/library/editor-context';
import { copyOfBase, type LibraryEditorForm } from '@/server/library/editor-form';
import { DocView } from '../doc-view';
import { fieldId, useEditorErrors } from './editor-errors';
import type { FormPatch } from './meta-fields';
import { VersionContent } from './version-content';

/** Every version of an item: the base version and at most 7 levels (`save_library_item`). */
const MAX_VERSIONS = 8;

/**
 * « Versions par niveau » (SPEC 9.2, D-066, D-073): a version of the content for a language
 * level, made by copying the base version (« Ajouter une version ») and then adapted by hand.
 * On a desktop the base version (as students see it) sits beside the level being edited; phones
 * show one at a time. Level names are shown to staff only, never printed (D-042). Versions for
 * the author's personal levels keep the item private.
 */
export function VersionsEditor({
  form,
  patch,
  context,
  subjectCode,
}: {
  form: LibraryEditorForm;
  patch: FormPatch;
  context: EditorContext;
  subjectCode: string | null;
}) {
  const t = useTranslations('libraryEdit.levels');
  const errors = useEditorErrors();
  const levelVersions = form.versions
    .map((v, index) => ({ v, index }))
    .filter(({ v }) => v.languageLevelId !== null);
  const [selected, setSelected] = useState<string | null>(
    levelVersions[0]?.v.languageLevelId ?? null,
  );
  const used = new Set(form.versions.map((v) => v.languageLevelId));
  const available = context.levels.filter((l) => l.active && !used.has(l.id));
  const [toAdd, setToAdd] = useState('');
  const current = levelVersions.find(({ v }) => v.languageLevelId === selected) ?? levelVersions[0];
  const levelLabel = (id: string | null) => {
    const level = context.levels.find((l) => l.id === id);
    if (!level) return t('otherLevel');
    return level.personal ? t('personal', { label: level.label }) : level.label;
  };
  const hasPersonal = levelVersions.some(
    ({ v }) => context.levels.find((l) => l.id === v.languageLevelId)?.personal,
  );

  const base = form.versions.find((v) => v.languageLevelId === null);
  const preview = useMemo(() => {
    if (!base) return null;
    const { content } = fromAuthoring(form.type, {
      type: form.type,
      content: base.content,
      solution: base.solution,
    });
    return renderStudentDoc(form.type, content, { itemTitle: form.title, number: 1 });
  }, [base, form.type, form.title]);

  const add = () => {
    const levelId = toAdd || available[0]?.id;
    if (!levelId || form.versions.length >= MAX_VERSIONS) return;
    patch({ versions: [...form.versions, copyOfBase(form, levelId)] });
    setSelected(levelId);
    setToAdd('');
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('intro')}</p>
      {hasPersonal ? <Notice tone="warning">{t('personalHint')}</Notice> : null}

      {levelVersions.length ? (
        <div role="group" aria-label={t('chooser')} className="flex flex-wrap gap-2">
          {levelVersions.map(({ v, index }) => {
            const on = current?.v.languageLevelId === v.languageLevelId;
            const flagged = errors.within(`versions.${index}`);
            return (
              <Button
                key={v.languageLevelId}
                variant={on ? 'primary' : 'secondary'}
                aria-pressed={on}
                onClick={() => setSelected(v.languageLevelId)}
              >
                {levelLabel(v.languageLevelId)}
                {flagged ? <span className="font-normal">({t('toFix')})</span> : null}
              </Button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-600">{t('none')}</p>
      )}

      {available.length && form.versions.length < MAX_VERSIONS ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('level')} htmlFor={fieldId('add-level')} className="w-60">
            <Select
              id={fieldId('add-level')}
              value={toAdd || available[0]!.id}
              onChange={(e) => setToAdd(e.target.value)}
            >
              {available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.personal ? t('personal', { label: l.label }) : l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" onClick={add}>
            <Plus aria-hidden />
            {t('add')}
          </Button>
        </div>
      ) : null}
      {errors.at('versions') ? (
        <p className="text-sm text-red-600" role="alert">
          {errors.at('versions')}
        </p>
      ) : null}

      {current ? (
        <div className="grid gap-4 md:grid-cols-2">
          <section
            aria-labelledby="version-base-preview"
            className="hidden rounded-lg border border-slate-200 bg-slate-50 p-3 md:block"
          >
            <h3 id="version-base-preview" className="mb-2 text-sm font-semibold text-slate-700">
              {t('basePreview')}
            </h3>
            {preview ? (
              <div className="max-h-[48rem] overflow-y-auto rounded bg-white p-3">
                <DocView doc={preview} />
              </div>
            ) : (
              <p className="text-sm text-slate-600">{t('noPreview')}</p>
            )}
          </section>
          <section aria-labelledby="version-level-editor" className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="version-level-editor"
                className={cn('text-base font-semibold text-slate-900')}
              >
                {t('editing', { label: levelLabel(current.v.languageLevelId) })}
              </h3>
              <ConfirmButton
                label={t('remove')}
                message={t('removeConfirm', { label: levelLabel(current.v.languageLevelId) })}
                confirmLabel={t('removeConfirmButton')}
                variant="secondary"
                size="md"
                onConfirm={() => {
                  patch({ versions: form.versions.filter((_, i) => i !== current.index) });
                  setSelected(null);
                }}
              />
            </div>
            <VersionContent
              form={form}
              index={current.index}
              subjectCode={subjectCode}
              onChange={(version) =>
                patch({
                  versions: form.versions.map((v, i) => (i === current.index ? version : v)),
                })
              }
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
