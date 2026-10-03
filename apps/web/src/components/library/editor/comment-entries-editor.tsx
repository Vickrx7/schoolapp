'use client';

import {
  ACHIEVEMENT_CATEGORIES,
  FIRST_NAME_TOKEN,
  LEARNING_SKILL_RATINGS,
  LEARNING_SKILLS,
  PROGRESS_MARKS,
  REPORT_ENTRY_KINDS,
  REPORT_ENTRY_MAX,
  type AchievementCategory,
  type LearningSkill,
  type LearningSkillRating,
  type ProgressMark,
  type ReportEntryKind,
} from '@lynx/content';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { fieldId, useEditorErrors } from './editor-errors';
import { removeAt } from './question-ops';
import { useRowKeys } from './row-keys';

export interface CommentEntry {
  kind: ReportEntryKind;
  skill: LearningSkill | null;
  level: number | null;
  progress: ProgressMark | null;
  rating: LearningSkillRating | null;
  category: AchievementCategory | null;
  expectationCodes: string[];
  neutral: string;
  feminine: string;
  masculine: string;
}

/** An attente of the bank, offered as a code an entry can be tied to. */
export interface EntryExpectation {
  code: string;
  text: string;
}

const MAX_CODES = 4;
const LEVELS = [1, 2, 3, 4] as const;

const blankEntry = (preset: Partial<CommentEntry>): CommentEntry => ({
  kind: 'strength',
  skill: null,
  level: null,
  progress: null,
  rating: null,
  category: null,
  expectationCodes: [],
  neutral: '',
  feminine: '',
  masculine: '',
  ...preset,
});

interface Group {
  key: string;
  title: string;
  hint?: string;
  /** What « Ajouter » gives a new entry of this group. */
  preset: Partial<CommentEntry>;
  /** Indexes of the entries in `entries`, in the bank's order. */
  indexes: number[];
}

/**
 * « Entrées » of a « Banque de commentaires de bulletin » (DECISIONS D-129, D-131): grouped by
 * attente (or by learning skill), then by kind (« Points forts », « Prochaines étapes »,
 * « Commentaires »), each entry with its level or mark, its category and its neutral text, and its
 * feminine and masculine texts folded away. The entries keep the bank's order; an entry whose
 * kind or attentes change moves to its new group and keeps the focus. What is typed is French
 * content (`lang="fr-CA"`); `{prénom}` marks where the student's first name goes.
 */
export function CommentEntriesEditor({
  label,
  entries,
  onChange,
  path,
  scope,
  period,
  expectations,
  min = 1,
  max = 160,
}: {
  label: string;
  entries: CommentEntry[];
  onChange: (entries: CommentEntry[]) => void;
  /** `versions.0.content.entries`. */
  path: string;
  scope: string;
  period: string;
  /** The bank's attentes (codes offered to its entries). */
  expectations: readonly EntryExpectation[];
  min?: number;
  max?: number;
}) {
  const t = useTranslations('libraryEdit');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const rows = useRowKeys(entries.length);
  const skills = scope === 'learning_skills';
  const full = entries.length >= max;

  const change = (index: number, next: CommentEntry, refocus?: keyof CommentEntry) => {
    onChange(entries.map((e, i) => (i === index ? next : e)));
    // The entry may move to another group: give the focus back to the field just changed.
    if (refocus) {
      requestAnimationFrame(() => {
        const element = document.getElementById(fieldId(`${path}.${index}.${refocus}`));
        if (element && document.activeElement !== element) element.focus();
      });
    }
  };
  const add = (preset: Partial<CommentEntry>) => onChange([...entries, blankEntry(preset)]);

  const groups: Group[] = [];
  if (skills) {
    for (const skill of LEARNING_SKILLS) {
      groups.push({
        key: skill,
        title: tc(`learningSkills.${skill}`),
        preset: { skill },
        indexes: entries.flatMap((e, i) => (e.skill === skill ? [i] : [])),
      });
    }
    const unset = entries.flatMap((e, i) => (e.skill === null ? [i] : []));
    if (unset.length) {
      groups.push({ key: '', title: t('commentEntries.chooseSkill'), preset: {}, indexes: unset });
    }
  } else {
    const keyOf = (e: CommentEntry) => e.expectationCodes.join(', ');
    const keys = [
      ...new Set([...expectations.map((e) => e.code), ...entries.map(keyOf).filter(Boolean)]),
    ];
    for (const key of keys) {
      groups.push({
        key,
        title: t('commentEntries.groupExpectation', { codes: key }),
        hint: expectations.find((e) => e.code === key)?.text,
        preset: { expectationCodes: key.split(', ') },
        indexes: entries.flatMap((e, i) => (keyOf(e) === key ? [i] : [])),
      });
    }
    groups.push({
      key: '',
      title: t('commentEntries.groupGeneral'),
      hint: t('commentEntries.groupGeneralHint'),
      preset: {},
      indexes: entries.flatMap((e, i) => (keyOf(e) === '' ? [i] : [])),
    });
  }

  const listError = errors.at(path);
  const entryErrors = entries.flatMap((_, i) =>
    (
      [
        'kind',
        'skill',
        'level',
        'progress',
        'rating',
        'category',
        'expectationCodes',
        'neutral',
        'feminine',
        'masculine',
      ] as const
    ).flatMap((field) => {
      const message = errors.at(`${path}.${i}.${field}`);
      return message ? [{ key: `${i}.${field}`, n: i + 1, message }] : [];
    }),
  );

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      <div className="space-y-1 text-sm text-slate-600">
        <p>{t('commentEntries.intro')}</p>
        <p>{t('commentEntries.tokenHint', { token: FIRST_NAME_TOKEN })}</p>
      </div>
      {groups.map((group) => (
        <section
          key={`${group.key}|${group.title}`}
          aria-label={group.title}
          className="space-y-3 rounded-lg border border-slate-200 p-3"
        >
          <div>
            <h3 className="text-base font-semibold text-slate-900">{group.title}</h3>
            {group.hint ? <p className="text-sm text-slate-600">{group.hint}</p> : null}
          </div>
          {REPORT_ENTRY_KINDS.map((kind) => {
            const indexes = group.indexes.filter((i) => entries[i]!.kind === kind);
            return (
              <div key={kind} className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-800">
                  {t(`commentEntries.kindHeadings.${kind}`)}
                </h4>
                {indexes.length ? (
                  <ol className="space-y-3">
                    {indexes.map((i) => (
                      <li key={rows.keys[i] ?? i}>
                        <EntryCard
                          entry={entries[i]!}
                          index={i}
                          path={`${path}.${i}`}
                          skills={skills}
                          period={period}
                          expectations={expectations}
                          canRemove={entries.length > min}
                          onChange={(next, refocus) => change(i, next, refocus)}
                          onRemove={() => {
                            rows.remove(i);
                            onChange(removeAt(entries, i));
                          }}
                        />
                      </li>
                    ))}
                  </ol>
                ) : null}
                <Button
                  variant="secondary"
                  size="md"
                  disabled={full}
                  onClick={() => add({ ...group.preset, kind })}
                >
                  <Plus aria-hidden />
                  {t('commentEntries.addTo', { kind: tc(`reportEntryKinds.${kind}`) })}
                  <span className="sr-only"> ({group.title})</span>
                </Button>
              </div>
            );
          })}
        </section>
      ))}
      <p className="text-sm text-slate-600 tabular-nums">
        {t('commentEntries.count', { count: entries.length, max })}
      </p>
      {entryErrors.length ? (
        <ul className="space-y-1 text-sm text-red-600" role="alert">
          {entryErrors.map((e) => (
            <li key={e.key}>{t('commentEntries.entryError', { n: e.n, message: e.message })}</li>
          ))}
        </ul>
      ) : null}
      {listError ? (
        <p className="text-sm text-red-600" role="alert">
          {listError}
        </p>
      ) : null}
    </fieldset>
  );
}

function EntryCard({
  entry,
  index,
  path,
  skills,
  period,
  expectations,
  canRemove,
  onChange,
  onRemove,
}: {
  entry: CommentEntry;
  index: number;
  path: string;
  skills: boolean;
  period: string;
  expectations: readonly EntryExpectation[];
  canRemove: boolean;
  onChange: (next: CommentEntry, refocus?: keyof CommentEntry) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('libraryEdit');
  const tc = useTranslations('libraryCommon');
  const errors = useEditorErrors();
  const name = t('commentEntries.entry', { n: index + 1 });
  const id = (field: keyof CommentEntry) => fieldId(`${path}.${field}`);
  const invalid = (field: keyof CommentEntry) => (errors.at(`${path}.${field}`) ? true : undefined);
  const levels = period !== 'progress';
  const progress = period !== 'term';
  const codes = [...new Set([...expectations.map((e) => e.code), ...entry.expectationCodes])];
  const formsOpen = Boolean(entry.feminine || entry.masculine);

  return (
    <fieldset
      className={cn(
        'space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3',
        errors.within(path) && 'border-red-300',
      )}
    >
      <legend className="sr-only">{name}</legend>
      <div className="flex items-center justify-between gap-2">
        <p aria-hidden className="text-sm font-semibold text-slate-800">
          {name}
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('commentEntries.remove', { n: index + 1 })}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('content.entries.kind')} htmlFor={id('kind')}>
          <Select
            id={id('kind')}
            value={entry.kind}
            aria-invalid={invalid('kind')}
            onChange={(e) =>
              onChange({ ...entry, kind: e.target.value as ReportEntryKind }, 'kind')
            }
          >
            {REPORT_ENTRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {tc(`reportEntryKinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {skills ? (
          <>
            <Field label={t('content.entries.skill')} htmlFor={id('skill')}>
              <Select
                id={id('skill')}
                value={entry.skill ?? ''}
                aria-invalid={invalid('skill')}
                onChange={(e) =>
                  onChange(
                    { ...entry, skill: (e.target.value || null) as LearningSkill | null },
                    'skill',
                  )
                }
              >
                <option value="">{t('commentEntries.chooseSkill')}</option>
                {LEARNING_SKILLS.map((s) => (
                  <option key={s} value={s}>
                    {tc(`learningSkills.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('content.entries.rating')} htmlFor={id('rating')}>
              <Select
                id={id('rating')}
                value={entry.rating ?? ''}
                aria-invalid={invalid('rating')}
                onChange={(e) =>
                  onChange({
                    ...entry,
                    rating: (e.target.value || null) as LearningSkillRating | null,
                  })
                }
              >
                <option value="">{t('commentEntries.anyRating')}</option>
                {LEARNING_SKILL_RATINGS.map((r) => (
                  <option key={r} value={r}>
                    {tc(`learningSkillRatings.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
        {levels && !skills ? (
          <Field label={t('content.entries.level')} htmlFor={id('level')}>
            <Select
              id={id('level')}
              value={entry.level === null ? '' : String(entry.level)}
              aria-invalid={invalid('level')}
              onChange={(e) =>
                onChange({ ...entry, level: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">{t('commentEntries.anyLevel')}</option>
              {LEVELS.map((n) => (
                <option key={n} value={String(n)}>
                  {t('commentEntries.levelOption', { n })}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {progress && !skills ? (
          <Field label={t('content.entries.progress')} htmlFor={id('progress')}>
            <Select
              id={id('progress')}
              value={entry.progress ?? ''}
              aria-invalid={invalid('progress')}
              onChange={(e) =>
                onChange({ ...entry, progress: (e.target.value || null) as ProgressMark | null })
              }
            >
              <option value="">{t('commentEntries.anyProgress')}</option>
              {PROGRESS_MARKS.map((m) => (
                <option key={m} value={m}>
                  {tc(`progressMarks.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {!skills ? (
          <Field
            label={t('content.entries.category')}
            htmlFor={id('category')}
            hint={t('commentEntries.categoryHint')}
          >
            <Select
              id={id('category')}
              value={entry.category ?? ''}
              aria-invalid={invalid('category')}
              onChange={(e) =>
                onChange({
                  ...entry,
                  category: (e.target.value || null) as AchievementCategory | null,
                })
              }
            >
              <option value="">{t('commentEntries.anyCategory')}</option>
              {ACHIEVEMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tc(`categories.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {!skills ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-slate-700">
            {t('content.entries.expectationCodes._label')}
          </legend>
          {codes.length ? (
            <>
              <div className="flex flex-wrap gap-x-4">
                {codes.map((code, c) => {
                  const on = entry.expectationCodes.includes(code);
                  return (
                    <label
                      key={code}
                      className="flex min-h-11 items-center gap-2 text-sm text-slate-800"
                    >
                      <input
                        type="checkbox"
                        className="size-5"
                        id={c === 0 ? id('expectationCodes') : undefined}
                        checked={on}
                        disabled={!on && entry.expectationCodes.length >= MAX_CODES}
                        onChange={() =>
                          onChange(
                            {
                              ...entry,
                              expectationCodes: on
                                ? entry.expectationCodes.filter((x) => x !== code)
                                : codes.filter(
                                    (x) => x === code || entry.expectationCodes.includes(x),
                                  ),
                            },
                            'expectationCodes',
                          )
                        }
                      />
                      {code}
                    </label>
                  );
                })}
              </div>
              <p className="text-sm text-slate-500">{t('commentEntries.codesHint')}</p>
            </>
          ) : (
            <p className="text-sm text-slate-600">{t('commentEntries.noCodes')}</p>
          )}
        </fieldset>
      ) : null}

      <Field
        label={t('content.entries.neutral')}
        htmlFor={id('neutral')}
        hint={t('commentEntries.tokenHint', { token: FIRST_NAME_TOKEN })}
      >
        <Textarea
          id={id('neutral')}
          lang="fr-CA"
          value={entry.neutral}
          maxLength={REPORT_ENTRY_MAX}
          className="min-h-20"
          aria-invalid={invalid('neutral')}
          onChange={(e) => onChange({ ...entry, neutral: e.target.value })}
        />
      </Field>
      <details open={formsOpen || undefined} className="group space-y-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-brand-700">
          {t('commentEntries.forms')}
        </summary>
        <div className="space-y-3 pt-2">
          {(['feminine', 'masculine'] as const).map((form) => (
            <Field key={form} label={t(`content.entries.${form}`)} htmlFor={id(form)}>
              <Textarea
                id={id(form)}
                lang="fr-CA"
                value={entry[form]}
                maxLength={REPORT_ENTRY_MAX}
                className="min-h-20"
                aria-invalid={invalid(form)}
                onChange={(e) => onChange({ ...entry, [form]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
