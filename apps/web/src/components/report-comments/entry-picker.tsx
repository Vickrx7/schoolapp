'use client';

import { entryText, fillComment, type CommentForm } from '@lynx/content';
import { wordingKey, type Suggestion, type Suggestions } from '@lynx/domain';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Entries that say the same thing differently (`wordingKey`) share one card. */
function slotsOf(suggestions: readonly Suggestion[]): Suggestion[][] {
  const slots = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const key = wordingKey(s.entry);
    slots.set(key, [...(slots.get(key) ?? []), s]);
  }
  return [...slots.values()];
}

/**
 * « Points forts », « Prochaines étapes » and « Commentaires généraux » (DECISIONS D-130): the
 * bank's entries for the student's mark as cards to tick, each showing the text already filled
 * in (« Aïcha… », « d’Aïcha ») in the student's wording, with its attente; « Autre formulation »
 * when the bank says the same thing another way; then, folded away, the entries about attentes
 * not taught during the period. Ticking a card builds the comment.
 */
export function EntryPicker({
  suggestions,
  firstName,
  form,
  picked,
  onToggle,
  needsMarkText,
}: {
  suggestions: Suggestions;
  firstName: string;
  form: CommentForm;
  picked: ReadonlySet<number>;
  onToggle: (index: number) => void;
  needsMarkText: string;
}) {
  const t = useTranslations('reportComments.editor');
  const groups = [
    { key: 'strengths', legend: t('strengths'), items: suggestions.strengths },
    { key: 'nextSteps', legend: t('nextSteps'), items: suggestions.nextSteps },
    { key: 'general', legend: t('general'), items: suggestions.general },
  ] as const;
  // Before a mark, only the groups with entries for every mark; after, « Aucune entrée » says so.
  const shown = groups.filter(
    (g) => g.items.length > 0 || (!suggestions.needsMark && g.key !== 'general'),
  );
  return (
    <div className="space-y-4">
      {suggestions.needsMark ? <p className="text-sm text-slate-700">{needsMarkText}</p> : null}
      {shown.map((g) => (
        <fieldset key={g.key} className="min-w-0 space-y-2">
          <legend className="text-base font-semibold text-slate-900">{g.legend}</legend>
          {g.items.length === 0 ? (
            <p className="text-sm text-slate-600">{t('noEntries')}</p>
          ) : (
            <ul className="space-y-2">
              {slotsOf(g.items).map((slot) => (
                <EntryCard
                  key={slot[0]!.entry.index}
                  slot={slot}
                  firstName={firstName}
                  form={form}
                  picked={picked}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          )}
        </fieldset>
      ))}
      {suggestions.outOfScope.length > 0 ? (
        <details className="group rounded-lg border border-slate-200 bg-slate-50">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-slate-800">
            {t('outOfScope', { count: suggestions.outOfScope.length })}
          </summary>
          <ul className="space-y-2 p-3 pt-0">
            {slotsOf(suggestions.outOfScope).map((slot) => (
              <EntryCard
                key={slot[0]!.entry.index}
                slot={slot}
                firstName={firstName}
                form={form}
                picked={picked}
                onToggle={onToggle}
                showKind
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function EntryCard({
  slot,
  firstName,
  form,
  picked,
  onToggle,
  showKind = false,
}: {
  slot: Suggestion[];
  firstName: string;
  form: CommentForm;
  picked: ReadonlySet<number>;
  onToggle: (index: number) => void;
  showKind?: boolean;
}) {
  const t = useTranslations('reportComments.editor');
  const tc = useTranslations('libraryCommon');
  const pickedAt = slot.findIndex((s) => picked.has(s.entry.index));
  const [chosen, setChosen] = useState(0);
  const at = pickedAt >= 0 ? pickedAt : chosen % slot.length;
  const { entry, fromNotes } = slot[at]!;
  const checked = picked.has(entry.index);
  const meta = [
    showKind ? tc(`reportEntryKinds.${entry.kind}`) : null,
    entry.skill ? tc(`learningSkills.${entry.skill}`) : null,
    entry.skill && entry.rating ? tc(`learningSkillRatings.${entry.rating}`) : null,
    entry.expectationCodes.length > 0
      ? t('attente', { codes: entry.expectationCodes.join(', ') })
      : null,
  ].filter(Boolean);
  return (
    <li>
      <div
        className={cn(
          'rounded-lg border bg-white transition-colors',
          checked ? 'border-brand-500 bg-brand-50' : 'border-slate-200',
        )}
      >
        <label className="flex min-h-11 cursor-pointer items-start gap-3 p-3">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-brand-600"
            checked={checked}
            onChange={() => onToggle(entry.index)}
          />
          <span className="min-w-0 space-y-1">
            <span lang="fr-CA" className="block leading-relaxed text-slate-900">
              {fillComment(entryText(entry, form), firstName)}
            </span>
            {meta.length > 0 || fromNotes ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                {meta.length > 0 ? <span>{meta.join(' · ')}</span> : null}
                {fromNotes ? <Badge tone="brand">{t('fromNotes')}</Badge> : null}
              </span>
            ) : null}
          </span>
        </label>
        {slot.length > 1 && !checked ? (
          <div className="border-t border-slate-100 px-3 py-1">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
              onClick={() => setChosen(at + 1)}
            >
              <RefreshCw className="size-4" aria-hidden />
              {t('otherWording')}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
