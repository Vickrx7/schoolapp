'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import type { ExpectationChoice } from '@/server/queries/year-plan';

/** Accents and case ignored: « equivalentes » finds « équivalentes ». */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

interface Entry {
  choice: ExpectationChoice;
  children: ExpectationChoice[];
}

/** By grade, then domaine: overall attentes with their specific ones under them. */
function groupChoices(options: readonly ExpectationChoice[]) {
  const ids = new Set(options.map((o) => o.id));
  const groups: { key: string; grade: string; strand: string | null; entries: Entry[] }[] = [];
  const byId = new Map<string, Entry>();
  for (const choice of options) {
    if (choice.parentId && ids.has(choice.parentId)) continue;
    const key = `${choice.gradeCode}|${choice.strand ?? ''}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, grade: choice.gradeLabel, strand: choice.strand, entries: [] };
      groups.push(group);
    }
    const entry = { choice, children: [] };
    byId.set(choice.id, entry);
    group.entries.push(entry);
  }
  for (const choice of options) {
    if (choice.parentId && ids.has(choice.parentId))
      byId.get(choice.parentId)?.children.push(choice);
  }
  return groups;
}

function Choice({
  choice,
  checked,
  mixed = false,
  showGrade,
  onToggle,
}: {
  choice: ExpectationChoice;
  checked: boolean;
  mixed?: boolean;
  showGrade: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('yearPlan.dialog');
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-1 py-2 text-sm hover:bg-slate-50">
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = mixed;
        }}
        onChange={onToggle}
      />
      <span className="min-w-0">
        <span className="font-semibold">
          {showGrade ? `${choice.gradeLabel} · ` : null}
          {choice.code}
        </span>{' '}
        {choice.text} {!choice.verified ? <Badge tone="warning">{t('unverified')}</Badge> : null}
      </span>
    </label>
  );
}

/**
 * « Attentes visées » (DECISIONS D-123): the subject's attentes for the class's grades, by
 * domaine, with a filter. Ticking an overall attente chooses it and all its specific ones; it
 * shows as partly ticked when only some are chosen.
 */
export function ExpectationPicker({
  options,
  selected,
  onChange,
}: {
  options: readonly ExpectationChoice[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('yearPlan.dialog');
  const filterId = useId();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupChoices(options), [options]);
  const showGrade = new Set(options.map((o) => o.gradeCode)).size > 1;
  const chosen = new Set(selected);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = (c: ExpectationChoice) => {
    const text = fold(`${c.code} ${c.text}`);
    return words.every((w) => text.includes(w));
  };

  const toggle = (id: string) =>
    onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleAll = (entry: Entry) => {
    const ids = [entry.choice.id, ...entry.children.map((c) => c.id)];
    const all = ids.every((id) => chosen.has(id));
    onChange(
      all
        ? selected.filter((x) => !ids.includes(x))
        : [...selected, ...ids.filter((id) => !chosen.has(id))],
    );
  };

  const visible = groups
    .map((g) => ({
      ...g,
      entries: g.entries
        .map((e) => ({
          ...e,
          shown: matches(e.choice) ? e.children : e.children.filter(matches),
        }))
        .filter((e) => matches(e.choice) || e.shown.length > 0),
    }))
    .filter((g) => g.entries.length > 0);

  return (
    <div className="space-y-2">
      <Field label={t('filter')} htmlFor={filterId}>
        <Input
          id={filterId}
          type="search"
          value={query}
          placeholder={t('filterPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      <p className="text-sm text-slate-600" aria-live="polite">
        {t('selected', { count: selected.length })}
      </p>
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {visible.length === 0 ? (
          <p className="p-2 text-sm text-slate-600">{t('noMatch')}</p>
        ) : (
          visible.map((g) => (
            <div key={g.key}>
              {g.strand || showGrade ? (
                <p className="px-1 text-xs font-semibold text-slate-600 uppercase">
                  {[showGrade ? g.grade : null, g.strand].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              <ul>
                {g.entries.map((e) => {
                  const ids = [e.choice.id, ...e.children.map((c) => c.id)];
                  const count = ids.filter((id) => chosen.has(id)).length;
                  return (
                    <li key={e.choice.id}>
                      <Choice
                        choice={e.choice}
                        checked={count === ids.length}
                        mixed={count > 0 && count < ids.length}
                        showGrade={showGrade}
                        onToggle={() => (e.children.length ? toggleAll(e) : toggle(e.choice.id))}
                      />
                      {e.shown.length ? (
                        <ul className="pl-6">
                          {e.shown.map((c) => (
                            <li key={c.id}>
                              <Choice
                                choice={c}
                                checked={chosen.has(c.id)}
                                showGrade={showGrade}
                                onToggle={() => toggle(c.id)}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
