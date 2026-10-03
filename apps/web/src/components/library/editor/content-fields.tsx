'use client';

import {
  TYPE_INFO,
  type AuthoringQuestion,
  type FieldSpec,
  type LibraryItemType,
} from '@lynx/content';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { Badge } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  CommentEntriesEditor,
  type CommentEntry,
  type EntryExpectation,
} from './comment-entries-editor';
import { fieldId, useEditorErrors } from './editor-errors';
import { limitsOf } from './field-limits';
import { NumberInput } from './number-input';
import { ObjectListEditor } from './object-list-editor';
import { QuestionListEditor } from './question-list-editor';
import { RubricEditor, type RubricCriterion } from './rubric-editor';
import { StringListEditor } from './string-list-editor';

const LESSON_PHASES = new Set(['opening', 'development', 'closing']);

type Messages = ReturnType<typeof useTranslations<'libraryEdit'>>;

/**
 * The label of a field of `EDITOR_SPEC` (`libraryEdit.content.<path>`). A list or a group has a
 * message object (`_label`, `_item` for one element, and its fields' labels); a lesson plan's
 * phases follow the subject (« Mise en train / Exploration / Objectivation » in mathematics,
 * « Avant / Pendant / Après » elsewhere).
 */
export function useFieldLabels(type: LibraryItemType, subjectCode: string | null) {
  const t = useTranslations('libraryEdit');
  return useCallback(
    (spec: FieldSpec) => resolveLabels(t, type, subjectCode, spec),
    [t, type, subjectCode],
  );
}

function resolveLabels(
  t: Messages,
  type: LibraryItemType,
  subjectCode: string | null,
  spec: FieldSpec,
): { label: string; item: string; add: string; hint: string | undefined } {
  const key = spec.labelKey;
  const has = (k: string) => t.has(k as 'content.title');
  const get = (k: string) => t(k as 'content.title');
  let label = has(`${key}._label`) ? get(`${key}._label`) : has(key) ? get(key) : spec.path;
  if (type === 'lesson_plan' && LESSON_PHASES.has(spec.path)) {
    label = get(`phases.${subjectCode === 'mat' ? 'mat' : 'default'}.${spec.path}`);
  }
  const item = has(`${key}._item`) ? get(`${key}._item`) : get('list.item');
  const add = has(`${key}._add`) ? get(`${key}._add`) : get('list.addDefault');
  // Hints are for the top-level fields (`content.title`), not same-named nested ones.
  const hintKey = `hints.${spec.path}`;
  const top = key.split('.').length === 2;
  return { label, item, add, hint: top && has(hintKey) ? get(hintKey) : undefined };
}

/** An empty element for a list of records, from its fields. */
export function emptyRecord(fields: readonly FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f.kind) {
      case 'text':
      case 'textarea':
        out[f.path] = '';
        break;
      case 'number':
        out[f.path] = f.nullable ? null : 1;
        break;
      case 'select':
        out[f.path] = f.nullable ? null : (f.options?.[0] ?? '');
        break;
      case 'boolean':
        out[f.path] = false;
        break;
      case 'object':
        out[f.path] = f.nullable ? null : emptyRecord(f.fields ?? []);
        break;
      default:
        out[f.path] = [];
    }
  }
  return out;
}

const asString = (v: unknown) => (typeof v === 'string' ? v : '');
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export interface ContentFieldsProps {
  type: LibraryItemType;
  specs: readonly FieldSpec[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Editor path of these fields (`versions.0.content`, `versions.0.content.sections.1`). */
  path: string;
  /** Their path from the content's root in `EDITOR_SPEC` terms, for list sizes (`sections`). */
  limitsPath: string;
  subjectCode: string | null;
  /** Every question id of the version (new questions get a fresh one). */
  questionIds: () => string[];
  /**
   * The language of what is typed here (`fr-CA`; `en-CA` in a family guide's English half). It
   * goes on the fields themselves: labels, hints and buttons are in the interface's language.
   */
  lang?: 'fr-CA' | 'en-CA';
  /** A comment bank's attentes, offered to its entries (D-129). */
  expectations?: readonly EntryExpectation[];
}

/**
 * « Contenu »: the fields of a type's content, driven by `EDITOR_SPEC` (@lynx/content), so every
 * type has its editor without a screen of its own. Teacher-only fields say so (they never reach
 * the student sheet). Content is French (`lang="fr-CA"` on each field), except the English half
 * of a family guide.
 */
export function ContentFields({
  type,
  specs,
  value,
  onChange,
  path,
  limitsPath,
  subjectCode,
  questionIds,
  lang = 'fr-CA',
  expectations = [],
}: ContentFieldsProps) {
  const t = useTranslations('libraryEdit');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const labels = useFieldLabels(type, subjectCode);
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  // A type with no student sheet says nothing about one (a comment bank is all for the staff).
  const sheet = TYPE_INFO[type].audience !== 'teacher';
  const teacherOnly = (spec: FieldSpec) => sheet && spec.audience === 'teacher';

  return (
    <div className="space-y-4">
      {specs.map((spec) => {
        if (spec.hidden) return null;
        const { label, item, add, hint } = labels(spec);
        const fieldPath = `${path}.${spec.path}`;
        const limits = limitsOf(type, limitsPath ? `${limitsPath}.${spec.path}` : spec.path);
        const error = errors.at(fieldPath);
        const shownLabel = teacherOnly(spec) ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {label}
            <Badge tone="warning">{t('teacherOnly')}</Badge>
          </span>
        ) : (
          label
        );
        const current = value[spec.path];
        const fieldLang = spec.lang ?? lang;

        switch (spec.kind) {
          case 'text':
          case 'textarea': {
            const Control = spec.kind === 'text' ? Input : Textarea;
            const long = (spec.maxLength ?? 0) >= 4000;
            return (
              <Field
                key={spec.path}
                label={shownLabel}
                htmlFor={fieldId(fieldPath)}
                hint={hint}
                error={error}
              >
                <Control
                  id={fieldId(fieldPath)}
                  lang={fieldLang}
                  value={asString(current)}
                  maxLength={spec.maxLength}
                  aria-invalid={error ? true : undefined}
                  className={
                    spec.kind === 'textarea' ? (long ? 'min-h-48' : 'min-h-20') : undefined
                  }
                  onChange={(e) => set(spec.path, e.target.value)}
                />
              </Field>
            );
          }
          case 'number':
            return (
              <Field
                key={spec.path}
                label={shownLabel}
                htmlFor={fieldId(fieldPath)}
                hint={hint}
                error={error}
              >
                <NumberInput
                  id={fieldId(fieldPath)}
                  className="w-32"
                  value={typeof current === 'number' ? current : null}
                  min={1}
                  nullable={spec.nullable}
                  aria-invalid={error ? true : undefined}
                  onValue={(n) => set(spec.path, n)}
                />
              </Field>
            );
          case 'select':
            return (
              <Field
                key={spec.path}
                label={shownLabel}
                htmlFor={fieldId(fieldPath)}
                hint={hint}
                error={error}
              >
                <Select
                  id={fieldId(fieldPath)}
                  value={asString(current)}
                  onChange={(e) => set(spec.path, e.target.value || (spec.nullable ? null : ''))}
                >
                  {spec.nullable ? <option value="">{t('none')}</option> : null}
                  {(spec.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {t.has(`options.${spec.optionsKey}.${o}` as 'none')
                        ? t(`options.${spec.optionsKey}.${o}` as 'none')
                        : // The library's shared vocabulary (a comment bank's « Pour », « Bulletin »).
                          tc.has(`${spec.optionsKey}.${o}` as 'scope.private')
                          ? tc(`${spec.optionsKey}.${o}` as 'scope.private')
                          : o}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          case 'boolean':
            return (
              <label
                key={spec.path}
                className="flex min-h-11 items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  checked={current === true}
                  onChange={(e) => set(spec.path, e.target.checked)}
                />
                {shownLabel}
              </label>
            );
          case 'stringList':
            return (
              <StringListEditor
                key={spec.path}
                label={teacherOnly(spec) ? `${label} (${t('teacherOnly')})` : label}
                itemLabel={item}
                addLabel={add}
                hint={hint}
                items={asArray<string>(current)}
                onChange={(next) => set(spec.path, next)}
                path={fieldPath}
                min={limits.min}
                max={limits.max}
                maxLength={limits.itemMaxLength}
                multiline={(limits.itemMaxLength ?? 0) > 300}
                lang={fieldLang}
              />
            );
          case 'objectList': {
            const fields = spec.fields ?? [];
            return (
              <ObjectListEditor
                key={spec.path}
                label={teacherOnly(spec) ? `${label} (${t('teacherOnly')})` : label}
                itemLabel={item}
                addLabel={add}
                hint={hint}
                items={asArray<Record<string, unknown>>(current)}
                onChange={(next) => set(spec.path, next)}
                path={fieldPath}
                min={limits.min}
                max={limits.max}
                newItem={() => emptyRecord(fields)}
                renderItem={(record, _i, change, itemPath) => (
                  <ContentFields
                    type={type}
                    specs={fields}
                    value={asRecord(record)}
                    onChange={change}
                    path={itemPath}
                    limitsPath={limitsPath ? `${limitsPath}.${spec.path}` : spec.path}
                    subjectCode={subjectCode}
                    questionIds={questionIds}
                    lang={fieldLang}
                  />
                )}
              />
            );
          }
          case 'object': {
            const fields = spec.fields ?? [];
            const present = current !== null && current !== undefined;
            return (
              <fieldset
                key={spec.path}
                className="space-y-3 rounded-lg border border-slate-200 p-3"
              >
                <legend className="px-1 text-sm font-medium text-slate-700">{label}</legend>
                {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
                {spec.nullable ? (
                  <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={present}
                      onChange={(e) =>
                        set(spec.path, e.target.checked ? emptyRecord(fields) : null)
                      }
                    />
                    {t('include', { label })}
                  </label>
                ) : null}
                {present ? (
                  <ContentFields
                    type={type}
                    specs={fields}
                    value={asRecord(current)}
                    onChange={(next) => set(spec.path, next)}
                    path={fieldPath}
                    limitsPath={limitsPath ? `${limitsPath}.${spec.path}` : spec.path}
                    subjectCode={subjectCode}
                    questionIds={questionIds}
                    lang={fieldLang}
                  />
                ) : null}
                {error ? (
                  <p className="text-sm text-red-600" role="alert">
                    {error}
                  </p>
                ) : null}
              </fieldset>
            );
          }
          case 'questions':
            return (
              <QuestionListEditor
                key={spec.path}
                label={label}
                questions={asArray<AuthoringQuestion>(current)}
                onChange={(next) => set(spec.path, next)}
                path={fieldPath}
                min={limits.min}
                max={limits.max}
                shortAnswerOnly={spec.shortAnswerOnly}
                takenIds={questionIds}
              />
            );
          case 'commentEntries':
            return (
              <CommentEntriesEditor
                key={spec.path}
                label={label}
                entries={asArray<CommentEntry>(current)}
                onChange={(next) => set(spec.path, next)}
                path={fieldPath}
                scope={asString(value.scope)}
                period={asString(value.period)}
                expectations={expectations}
                min={limits.min}
                max={limits.max}
              />
            );
          case 'rubric':
            return (
              <RubricEditor
                key={spec.path}
                label={label}
                criteria={asArray<RubricCriterion>(current)}
                onChange={(next) => set(spec.path, next)}
                path={fieldPath}
                min={limits.min}
                max={limits.max}
              />
            );
        }
      })}
    </div>
  );
}
