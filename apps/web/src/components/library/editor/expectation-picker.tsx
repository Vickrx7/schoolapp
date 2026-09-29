'use client';

import { TYPE_INFO } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field, Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { listExpectations } from '@/server/actions/library';
import {
  groupExpectations,
  subjectsForGrades,
  type EditorContext,
  type EditorExpectation,
} from '@/server/library/editor-context';
import type { LibraryEditorForm } from '@/server/library/editor-form';
import { fieldId, useEditorErrors } from './editor-errors';
import type { FormPatch } from './meta-fields';

const MAX_GRADES = 4;
const MAX_EXPECTATIONS = 12;
/** Grades and subject are often changed a few taps at a time: load once they settle. */
const LOAD_DELAY_MS = 300;

/**
 * « Curriculum »: grades (up to 4), the subject (those taught in the chosen grades, Anglais from
 * the board's start grade), then the attentes of those grades in that subject, by domaine,
 * overall attentes before their contenus d'apprentissage, each unverified one marked
 * « À vérifier » (D-030). Changing grades or subject reloads the attentes (once the choice
 * settles) and drops the ones that no longer apply (the database would refuse them); a load
 * overtaken by another choice changes nothing. A failed load offers « Réessayer ».
 */
export function CurriculumFields({
  form,
  patch,
  context,
}: {
  form: LibraryEditorForm;
  patch: FormPatch;
  context: EditorContext;
}) {
  const t = useTranslations('libraryEdit.curriculum');
  const tc = useTranslations('libraryCommon');
  const tCommon = useTranslations('common');
  const errors = useEditorErrors();
  const [options, setOptions] = useState<EditorExpectation[]>(context.expectations);
  const [loading, startLoading] = useTransition();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The grades and subject of the attentes on screen (a successful load, or the page's).
  const loadedFor = useRef(`${[...form.gradeCodes].sort().join(',')}|${form.subjectId ?? ''}`);
  const subjects = subjectsForGrades(context, form.gradeCodes);
  const gradeOrder = context.grades.map((g) => g.code);
  const optional = TYPE_INFO[form.type].expectationsOptional;

  // Reload the attentes when the grades or the subject change (not on the first render), or on
  // « Réessayer ».
  const wanted = `${[...form.gradeCodes].sort().join(',')}|${form.subjectId ?? ''}`;
  const { gradeCodes, subjectId } = form;
  const latest = useRef({ wanted, expectationIds: form.expectationIds });
  useEffect(() => {
    latest.current = { wanted, expectationIds: form.expectationIds };
  });
  useEffect(() => {
    if (wanted === loadedFor.current) {
      setFailed(false);
      return;
    }
    const timer = window.setTimeout(() => {
      startLoading(async () => {
        const result = await listExpectations(gradeCodes, subjectId).catch(() => null);
        // Overtaken by another choice: that one's load decides.
        if (latest.current.wanted !== wanted) return;
        if (!result || !result.ok) {
          setFailed(true);
          return;
        }
        loadedFor.current = wanted;
        setFailed(false);
        setOptions(result.data);
        const available = new Set(result.data.map((e) => e.id));
        const ids = latest.current.expectationIds;
        const kept = ids.filter((id) => available.has(id));
        if (kept.length !== ids.length) patch({ expectationIds: kept });
      });
    }, LOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Only when what is asked for changes, or on « Réessayer ».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, attempt]);

  const chosen = new Set(form.expectationIds);
  const toggle = (id: string) =>
    patch({
      expectationIds: chosen.has(id)
        ? form.expectationIds.filter((e) => e !== id)
        : [...form.expectationIds, id],
    });
  const gradeLabel = (code: string) => context.grades.find((g) => g.code === code)?.label ?? code;
  const expectationError = errors.at('expectationIds') ?? errors.at('readiness.expectations');

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">
          {t('grades', { max: MAX_GRADES })}
        </legend>
        <div className="flex flex-wrap gap-2">
          {context.grades.map((g) => {
            const on = form.gradeCodes.includes(g.code);
            return (
              <Chip
                key={g.code}
                type="checkbox"
                name="grades"
                value={g.code}
                checked={on}
                disabled={!on && form.gradeCodes.length >= MAX_GRADES}
                onChange={() =>
                  patch({
                    gradeCodes: on
                      ? form.gradeCodes.filter((c) => c !== g.code)
                      : [...form.gradeCodes, g.code].sort(
                          (a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b),
                        ),
                  })
                }
              >
                {g.label}
              </Chip>
            );
          })}
        </div>
        {(errors.at('gradeCodes') ?? errors.at('readiness.grades')) ? (
          <p className="text-sm text-red-600" role="alert">
            {errors.at('gradeCodes') ?? errors.at('readiness.grades')}
          </p>
        ) : null}
      </fieldset>

      <Field
        label={t('subject')}
        htmlFor={fieldId('subjectId')}
        error={errors.at('subjectId') ?? errors.at('readiness.subject')}
      >
        <Select
          id={fieldId('subjectId')}
          value={form.subjectId ?? ''}
          onChange={(e) => patch({ subjectId: e.target.value || null })}
        >
          <option value="">{t('chooseSubject')}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="space-y-2" aria-busy={loading || undefined}>
        <legend className="text-sm font-medium text-slate-700">
          {t('expectations', { count: form.expectationIds.length, max: MAX_EXPECTATIONS })}
        </legend>
        <p className="text-sm text-slate-500">
          {optional ? t('expectationsOptional') : t('expectationsHint')}
        </p>
        {!form.subjectId || !form.gradeCodes.length ? (
          <p className="text-sm text-slate-600">{t('chooseFirst')}</p>
        ) : loading ? (
          <p className="text-sm text-slate-600" role="status">
            {t('loading')}
          </p>
        ) : failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-red-600" role="alert">
              {t('loadFailed')}
            </p>
            <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
              {tCommon('retry')}
            </Button>
          </div>
        ) : options.length === 0 ? (
          <p className="text-sm text-slate-600">{t('noExpectations')}</p>
        ) : (
          <div className="space-y-3">
            {groupExpectations(options, gradeOrder).map((group) => (
              <div key={`${group.gradeCode}:${group.strand?.id ?? ''}`} className="space-y-1">
                <p className="text-sm font-semibold text-slate-800">
                  {form.gradeCodes.length > 1 ? `${gradeLabel(group.gradeCode)} · ` : ''}
                  {group.strand
                    ? t('strand', { code: group.strand.code, label: group.strand.label })
                    : t('otherStrand')}
                </p>
                <ul className="space-y-1">
                  {group.expectations.map((e) => {
                    const on = chosen.has(e.id);
                    return (
                      <li key={e.id} className={cn(e.kind === 'specific' && 'pl-6')}>
                        <label className="flex min-h-11 cursor-pointer items-start gap-2 py-1 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-5 shrink-0"
                            checked={on}
                            disabled={!on && form.expectationIds.length >= MAX_EXPECTATIONS}
                            onChange={() => toggle(e.id)}
                          />
                          <span>
                            <span className="font-semibold">{e.code}</span>{' '}
                            <span className="text-slate-600">
                              ({tc(`expectationKinds.${e.kind}`)})
                            </span>{' '}
                            {e.text}{' '}
                            {e.verified ? null : (
                              <Badge tone="warning">{tc('badges.toVerify')}</Badge>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {expectationError ? (
          <p className="text-sm text-red-600" role="alert">
            {expectationError}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
