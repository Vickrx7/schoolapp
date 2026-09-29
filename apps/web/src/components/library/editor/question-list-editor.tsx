'use client';

import {
  ACHIEVEMENT_CATEGORIES,
  letter,
  type AchievementCategory,
  type AuthoringQuestion,
  type QuestionKind,
} from '@lynx/content';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { fieldId, useEditorErrors } from './editor-errors';
import { AddButton, ItemControls } from './list-controls';
import {
  QUESTION_LIMITS,
  addAcceptable,
  addChoice,
  addExtraRight,
  addItem,
  addPair,
  addQuestion,
  canAddExtraRight,
  canAddPair,
  changeKind,
  clampInt,
  kindsFor,
  move,
  moveItem,
  removeAcceptable,
  removeAt,
  removeChoice,
  removeExtraRight,
  removeItem,
  removePair,
  setAcceptable,
  setChoiceText,
  setExtraRight,
  setItem,
  setMultipleAnswers,
  setPair,
  toggleCorrect,
} from './question-ops';

type Of<K extends QuestionKind> = Extract<AuthoringQuestion, { kind: K }>;

/**
 * The question editor (DECISIONS D-062): every question kind with its correct answers entered
 * inline — the correct choices ticked, the true/false answer, each left-hand item written with
 * its match, ordering items in the right order, a sample answer and accepted answers. The answers
 * go to the answer key when saved, never into the student sheet; ordering items and matching
 * right columns are scrambled for the students (« Écrivez les éléments dans le bon ordre : ils
 * seront mélangés pour les élèves. »). Each question is a labelled group, so screen readers hear
 * « Question 3 » before its fields.
 */
export function QuestionListEditor({
  label,
  questions,
  onChange,
  path,
  min = 0,
  max = 30,
  shortAnswerOnly = false,
  takenIds,
}: {
  label: string;
  questions: AuthoringQuestion[];
  onChange: (questions: AuthoringQuestion[]) => void;
  /** Editor path of the list (`versions.0.content.questions`). */
  path: string;
  min?: number;
  max?: number;
  shortAnswerOnly?: boolean;
  /** Ids of the item's questions in other lists (a unit test's other sections). */
  takenIds: () => string[];
}) {
  const t = useTranslations('libraryEdit.questions');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const kinds = kindsFor(shortAnswerOnly);
  const [newKind, setNewKind] = useState<QuestionKind>(kinds[0]!);
  const listError = errors.at(path);

  return (
    <fieldset className="space-y-3" lang="fr-CA">
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      {questions.length ? (
        <ol className="space-y-4">
          {questions.map((q, i) => (
            <li key={`${q.id}-${i}`}>
              <QuestionEditor
                question={q}
                number={i + 1}
                count={questions.length}
                path={`${path}.${i}`}
                kinds={kinds}
                onChange={(next) => onChange(questions.map((x, j) => (j === i ? next : x)))}
                onMove={(direction) => onChange(move(questions, i, direction))}
                onRemove={() => onChange(removeAt(questions, i))}
                canRemove={questions.length > min}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-600">{t('empty')}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {kinds.length > 1 ? (
          <Field label={t('newKind')} htmlFor={fieldId(`${path}-new-kind`)} className="w-56">
            <Select
              id={fieldId(`${path}-new-kind`)}
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as QuestionKind)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {tc(`questionKinds.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <AddButton
          label={t('add')}
          count={questions.length}
          min={min}
          max={max}
          onAdd={() => onChange(addQuestion(questions, newKind, takenIds()))}
        />
      </div>
      {listError ? (
        <p className="text-sm text-red-600" role="alert">
          {listError}
        </p>
      ) : null}
    </fieldset>
  );
}

function QuestionEditor({
  question: q,
  number,
  count,
  path,
  kinds,
  onChange,
  onMove,
  onRemove,
  canRemove,
}: {
  question: AuthoringQuestion;
  number: number;
  count: number;
  path: string;
  kinds: readonly QuestionKind[];
  onChange: (q: AuthoringQuestion) => void;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const t = useTranslations('libraryEdit.questions');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const name = t('numbered', { n: number });
  const id = (field: string) => fieldId(`${path}.${field}`);
  const err = (field: string) => errors.at(`${path}.${field}`);
  const questionError = errors.at(path);
  const set = <K extends keyof AuthoringQuestion>(field: K, value: AuthoringQuestion[K]) =>
    onChange({ ...q, [field]: value } as AuthoringQuestion);

  return (
    <fieldset
      className={cn(
        'space-y-3 rounded-lg border border-slate-200 bg-white p-3 md:p-4',
        errors.within(path) && 'border-red-300',
      )}
    >
      <legend className="sr-only">{`${name} · ${tc(`questionKinds.${q.kind}`)}`}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-hidden className="font-semibold text-slate-900">
          {name} · {tc(`questionKinds.${q.kind}`)}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {kinds.length > 1 ? (
            <Select
              aria-label={t('kind', { name })}
              value={q.kind}
              className="w-44"
              onChange={(e) => onChange(changeKind(q, e.target.value as QuestionKind))}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {tc(`questionKinds.${k}`)}
                </option>
              ))}
            </Select>
          ) : null}
          <ItemControls
            name={name}
            index={number - 1}
            count={count}
            onMove={onMove}
            onRemove={onRemove}
            canRemove={canRemove}
          />
        </div>
      </div>
      {questionError ? (
        <p className="text-sm text-red-600" role="alert">
          {questionError}
        </p>
      ) : null}

      <Field label={t('prompt')} htmlFor={id('prompt')} error={err('prompt')}>
        <Textarea
          id={id('prompt')}
          value={q.prompt}
          maxLength={1000}
          className="min-h-16"
          aria-invalid={err('prompt') ? true : undefined}
          onChange={(e) => set('prompt', e.target.value)}
        />
      </Field>

      {q.kind === 'multiple_choice' ? (
        <ChoicesEditor q={q} path={path} onChange={onChange} />
      ) : q.kind === 'true_false' ? (
        <TrueFalseEditor q={q} path={path} onChange={onChange} />
      ) : q.kind === 'matching' ? (
        <MatchingEditor q={q} path={path} onChange={onChange} />
      ) : q.kind === 'ordering' ? (
        <OrderingEditor q={q} path={path} onChange={onChange} />
      ) : (
        <ShortAnswerEditor q={q} path={path} onChange={onChange} />
      )}

      <Field label={t('hint')} htmlFor={id('hint')} error={err('hint')}>
        <Input
          id={id('hint')}
          value={q.hint}
          maxLength={300}
          onChange={(e) => set('hint', e.target.value)}
        />
      </Field>
      <Field
        label={t('explanation')}
        htmlFor={id('explanation')}
        hint={t('explanationHint')}
        error={err('explanation')}
      >
        <Textarea
          id={id('explanation')}
          value={q.explanation}
          maxLength={500}
          className="min-h-16"
          onChange={(e) => set('explanation', e.target.value)}
        />
      </Field>
      <details
        className="rounded-lg border border-slate-200 px-3 py-2"
        open={Boolean(err('points') || err('category')) || undefined}
      >
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-700">
          {t('more')}
        </summary>
        <div className="grid gap-3 pb-2 sm:grid-cols-2">
          <Field
            label={t('points')}
            htmlFor={id('points')}
            hint={t('pointsHint')}
            error={err('points')}
          >
            <Input
              id={id('points')}
              type="number"
              inputMode="numeric"
              min={QUESTION_LIMITS.points.min}
              max={QUESTION_LIMITS.points.max}
              value={q.points ?? ''}
              onChange={(e) => set('points', clampInt(e.target.value, QUESTION_LIMITS.points))}
            />
          </Field>
          <Field
            label={t('category')}
            htmlFor={id('category')}
            hint={t('categoryHint')}
            error={err('category')}
          >
            <Select
              id={id('category')}
              value={q.category ?? ''}
              onChange={(e) =>
                set('category', (e.target.value || null) as AchievementCategory | null)
              }
            >
              <option value="">{t('noCategory')}</option>
              {ACHIEVEMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tc(`categories.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </details>
    </fieldset>
  );
}

/** A group of answer fields with a legend, a hint and the error of the whole group. */
function AnswerGroup({
  legend,
  hint,
  error,
  children,
}: {
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-2 rounded-lg bg-emerald-50/60 p-3 ring-1 ring-emerald-200 ring-inset">
      <legend className="sr-only">{legend}</legend>
      <p aria-hidden className="text-sm font-medium text-emerald-900">
        {legend}
      </p>
      {hint ? <p className="text-sm text-slate-600">{hint}</p> : null}
      {children}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
      <Trash2 aria-hidden />
    </Button>
  );
}

function ChoicesEditor({
  q,
  path,
  onChange,
}: {
  q: Of<'multiple_choice'>;
  path: string;
  onChange: (q: AuthoringQuestion) => void;
}) {
  const t = useTranslations('libraryEdit.questions');
  const errors = useEditorErrors();
  const group = fieldId(`${path}.correct`);
  return (
    <AnswerGroup
      legend={t('choices')}
      hint={q.multipleAnswers ? t('choicesHintMany') : t('choicesHintOne')}
      error={errors.at(`${path}.choices`)}
    >
      <ol className="space-y-2">
        {q.choices.map((choice, i) => {
          const name = t('choice', { letter: letter(i) });
          const textPath = `${path}.choices.${i}.text`;
          const error = errors.at(textPath);
          return (
            <li key={choice.id} className="flex items-start gap-2">
              <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type={q.multipleAnswers ? 'checkbox' : 'radio'}
                  name={group}
                  className="size-5 accent-emerald-700"
                  checked={choice.correct}
                  onChange={() => onChange(toggleCorrect(q, i))}
                />
                <span className="sr-only">{t('correctChoice', { name })}</span>
                <span aria-hidden className="w-4 font-semibold">
                  {letter(i)}
                </span>
              </label>
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  id={fieldId(textPath)}
                  aria-label={name}
                  aria-invalid={error ? true : undefined}
                  value={choice.text}
                  maxLength={300}
                  onChange={(e) => onChange(setChoiceText(q, i, e.target.value))}
                />
                {error ? (
                  <p className="text-sm text-red-600" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
              <RemoveButton
                label={t('removeChoice', { name })}
                disabled={q.choices.length <= QUESTION_LIMITS.choices.min}
                onClick={() => onChange(removeChoice(q, i))}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <AddButton
          label={t('addChoice')}
          count={q.choices.length}
          min={QUESTION_LIMITS.choices.min}
          max={QUESTION_LIMITS.choices.max}
          onAdd={() => onChange(addChoice(q))}
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-5"
            checked={q.multipleAnswers}
            onChange={(e) => onChange(setMultipleAnswers(q, e.target.checked))}
          />
          {t('multipleAnswers')}
        </label>
      </div>
    </AnswerGroup>
  );
}

function TrueFalseEditor({
  q,
  path,
  onChange,
}: {
  q: Of<'true_false'>;
  path: string;
  onChange: (q: AuthoringQuestion) => void;
}) {
  const t = useTranslations('libraryEdit.questions');
  const errors = useEditorErrors();
  const name = fieldId(`${path}.correct`);
  return (
    <AnswerGroup legend={t('trueFalse')} error={errors.at(`${path}.correct`)}>
      <div role="radiogroup" aria-label={t('trueFalse')} className="flex flex-wrap gap-4">
        {[true, false].map((value) => (
          <label
            key={String(value)}
            className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700"
          >
            <input
              type="radio"
              name={name}
              className="size-5 accent-emerald-700"
              checked={q.correct === value}
              onChange={() => onChange({ ...q, correct: value })}
            />
            {value ? t('true') : t('false')}
          </label>
        ))}
      </div>
    </AnswerGroup>
  );
}

function MatchingEditor({
  q,
  path,
  onChange,
}: {
  q: Of<'matching'>;
  path: string;
  onChange: (q: AuthoringQuestion) => void;
}) {
  const t = useTranslations('libraryEdit.questions');
  const errors = useEditorErrors();
  return (
    <AnswerGroup legend={t('pairs')} hint={t('pairsHint')} error={errors.at(`${path}.pairs`)}>
      <ol className="space-y-2">
        {q.pairs.map((pair, i) => {
          const leftPath = `${path}.pairs.${i}.left`;
          const leftError = errors.at(leftPath);
          return (
            <li key={pair.leftId} className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Input
                    id={fieldId(leftPath)}
                    aria-label={t('left', { n: i + 1 })}
                    placeholder={t('left', { n: i + 1 })}
                    aria-invalid={leftError ? true : undefined}
                    value={pair.left}
                    maxLength={300}
                    onChange={(e) => onChange(setPair(q, i, { left: e.target.value }))}
                  />
                  {leftError ? (
                    <p className="text-sm text-red-600" role="alert">
                      {leftError}
                    </p>
                  ) : null}
                </div>
                <Input
                  aria-label={t('right', { n: i + 1 })}
                  placeholder={t('right', { n: i + 1 })}
                  value={pair.right}
                  maxLength={300}
                  onChange={(e) => onChange(setPair(q, i, { right: e.target.value }))}
                />
              </div>
              <RemoveButton
                label={t('removePair', { n: i + 1 })}
                disabled={q.pairs.length <= QUESTION_LIMITS.pairs.min}
                onClick={() => onChange(removePair(q, i))}
              />
            </li>
          );
        })}
      </ol>
      <AddButton
        label={t('addPair')}
        count={q.pairs.length}
        min={QUESTION_LIMITS.pairs.min}
        max={canAddPair(q) ? QUESTION_LIMITS.pairs.max : q.pairs.length}
        onAdd={() => onChange(addPair(q))}
      />
      <div className="space-y-2 pt-1">
        <p className="text-sm text-slate-600">{t('extraRightHint')}</p>
        {q.extraRight.length ? (
          <ol className="space-y-2">
            {q.extraRight.map((item, i) => (
              <li key={item.id} className="flex items-start gap-2">
                <Input
                  aria-label={t('extraRight', { n: i + 1 })}
                  value={item.text}
                  maxLength={300}
                  onChange={(e) => onChange(setExtraRight(q, i, e.target.value))}
                />
                <RemoveButton
                  label={t('removeExtraRight', { n: i + 1 })}
                  onClick={() => onChange(removeExtraRight(q, i))}
                />
              </li>
            ))}
          </ol>
        ) : null}
        <AddButton
          label={t('addExtraRight')}
          count={q.pairs.length + q.extraRight.length}
          min={0}
          max={
            canAddExtraRight(q) ? QUESTION_LIMITS.right.max : q.pairs.length + q.extraRight.length
          }
          onAdd={() => onChange(addExtraRight(q))}
        />
      </div>
    </AnswerGroup>
  );
}

function OrderingEditor({
  q,
  path,
  onChange,
}: {
  q: Of<'ordering'>;
  path: string;
  onChange: (q: AuthoringQuestion) => void;
}) {
  const t = useTranslations('libraryEdit.questions');
  const errors = useEditorErrors();
  return (
    <AnswerGroup legend={t('items')} hint={t('itemsHint')} error={errors.at(`${path}.items`)}>
      <ol className="space-y-2">
        {q.items.map((item, i) => {
          const name = t('item', { n: i + 1 });
          return (
            <li key={item.id} className="flex items-start gap-2">
              <span
                aria-hidden
                className="flex min-h-11 w-6 items-center justify-end text-sm font-semibold text-slate-600 tabular-nums"
              >
                {i + 1}.
              </span>
              <Input
                aria-label={name}
                value={item.text}
                maxLength={300}
                onChange={(e) => onChange(setItem(q, i, e.target.value))}
              />
              <ItemControls
                name={name}
                index={i}
                count={q.items.length}
                onMove={(direction) => onChange(moveItem(q, i, direction))}
                onRemove={() => onChange(removeItem(q, i))}
                canRemove={q.items.length > QUESTION_LIMITS.items.min}
              />
            </li>
          );
        })}
      </ol>
      <AddButton
        label={t('addItem')}
        count={q.items.length}
        min={QUESTION_LIMITS.items.min}
        max={QUESTION_LIMITS.items.max}
        onAdd={() => onChange(addItem(q))}
      />
    </AnswerGroup>
  );
}

function ShortAnswerEditor({
  q,
  path,
  onChange,
}: {
  q: Of<'short_answer'>;
  path: string;
  onChange: (q: AuthoringQuestion) => void;
}) {
  const t = useTranslations('libraryEdit.questions');
  const errors = useEditorErrors();
  const id = (field: string) => fieldId(`${path}.${field}`);
  return (
    <AnswerGroup legend={t('shortAnswer')}>
      <Field
        label={t('sampleAnswer')}
        htmlFor={id('sampleAnswer')}
        error={errors.at(`${path}.sampleAnswer`)}
      >
        <Textarea
          id={id('sampleAnswer')}
          value={q.sampleAnswer}
          maxLength={1000}
          className="min-h-16"
          onChange={(e) => onChange({ ...q, sampleAnswer: e.target.value })}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">{t('acceptable')}</legend>
        <p className="text-sm text-slate-600">{t('acceptableHint')}</p>
        {q.acceptableAnswers.length ? (
          <ol className="space-y-2">
            {q.acceptableAnswers.map((answer, i) => {
              const answerPath = `${path}.acceptableAnswers.${i}`;
              const error = errors.at(answerPath);
              return (
                <li key={i} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Input
                      id={fieldId(answerPath)}
                      aria-label={t('acceptableN', { n: i + 1 })}
                      aria-invalid={error ? true : undefined}
                      value={answer}
                      maxLength={100}
                      onChange={(e) => onChange(setAcceptable(q, i, e.target.value))}
                    />
                    {error ? (
                      <p className="text-sm text-red-600" role="alert">
                        {error}
                      </p>
                    ) : null}
                  </div>
                  <RemoveButton
                    label={t('removeAcceptable', { n: i + 1 })}
                    onClick={() => onChange(removeAcceptable(q, i))}
                  />
                </li>
              );
            })}
          </ol>
        ) : null}
        <AddButton
          label={t('addAcceptable')}
          count={q.acceptableAnswers.length}
          min={0}
          max={QUESTION_LIMITS.acceptableAnswers.max}
          onAdd={() => onChange(addAcceptable(q))}
        />
      </fieldset>
      <Field
        label={t('lines')}
        htmlFor={id('lines')}
        hint={t('linesHint')}
        error={errors.at(`${path}.lines`)}
      >
        <Input
          id={id('lines')}
          type="number"
          inputMode="numeric"
          className="w-28"
          min={QUESTION_LIMITS.lines.min}
          max={QUESTION_LIMITS.lines.max}
          value={q.lines}
          onChange={(e) =>
            onChange({
              ...q,
              lines: clampInt(e.target.value, QUESTION_LIMITS.lines) ?? QUESTION_LIMITS.lines.min,
            })
          }
        />
      </Field>
    </AnswerGroup>
  );
}
