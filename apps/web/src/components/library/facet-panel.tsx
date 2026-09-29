'use client';

import { LIBRARY_BUCKETS, LIBRARY_ITEM_TYPES } from '@lynx/content';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useOptimistic, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import {
  DURATION_BANDS,
  FORMAT_KEYS,
  clearFilters,
  facetFilterCount,
  hasFilters,
  libraryHref,
  subjectsForGrade,
  withChanges,
  type LibrarySearch,
} from '@/server/library/search-params';
import type { LibraryFacets } from '@/server/queries/library-search';
import { useSearchNavigation } from './search-navigation';

export interface FacetOptions {
  grades: { code: string; label: string; ordinal: number }[];
  /** Every subject; those of the chosen grade are offered (Anglais from the board's start grade). */
  subjects: { id: string; code: string; label: string; gradeMin: number; gradeMax: number }[];
  anglaisStartGrade: number;
  levels: { id: string; label: string; personal: boolean; active: boolean }[];
}

interface PanelProps {
  search: LibrarySearch;
  facets: LibraryFacets;
  options: FacetOptions;
}

/** A checkbox or radio button on a 44 px row, with the number of resources it would show. */
function Choice({
  type,
  name,
  label,
  count,
  checked,
  onChange,
}: {
  type: 'checkbox' | 'radio';
  name: string;
  label: ReactNode;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  const t = useTranslations('library.filters');
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-slate-800 hover:bg-slate-50"
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-5 shrink-0 accent-brand-600"
      />
      <span className="min-w-0 flex-1">{label}</span>
      {count !== undefined ? (
        <>
          <span className="text-slate-500 tabular-nums" aria-hidden>
            {count}
          </span>
          <span className="sr-only">{t('count', { count })}</span>
        </>
      ) : null}
    </label>
  );
}

function Group({ legend, children }: { legend: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-semibold text-slate-900">{legend}</legend>
      {children}
    </fieldset>
  );
}

const toggle = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * The filters of the results (D-068): grade and subject, then « Type » and « Catégorie »
 * (several at once), « Durée », « Format », « Pour la suppléance », « Approuvées par le conseil
 * seulement » and « Niveau de langue ». Each choice shows how many resources it would give with
 * the other filters (each facet ignores its own selection). A change applies at once: the address
 * changes and the server renders the results again. Drawn in the desktop side panel and in the
 * phone's « Filtres » sheet.
 */
export function FacetPanel({ search: current, facets, options }: PanelProps) {
  const t = useTranslations('library.filters');
  const tc = useTranslations('libraryCommon');
  const { navigate } = useSearchNavigation();
  const idBase = useId();
  // Choices show at once, while the server renders their results; quick successive choices add
  // up rather than replace each other.
  const [search, setSearch] = useOptimistic(current);
  const apply = (next: LibrarySearch) => navigate(libraryHref(next), () => setSearch(next));
  const go = (changes: Partial<LibrarySearch>) => apply(withChanges(search, changes));

  const grade = options.grades.find((g) => g.code === search.grade) ?? null;
  // The subjects of the chosen grade, and the one chosen (a choice never disappears).
  const offered = grade ? subjectsForGrade(options, grade.ordinal) : options.subjects;
  const subjects = options.subjects.filter((s) => s.id === search.subject || offered.includes(s));
  // Types with resources, and those chosen (a choice never disappears).
  const types = LIBRARY_ITEM_TYPES.filter(
    (type) => (facets.type[type] ?? 0) > 0 || search.types.includes(type),
  );
  const levels = options.levels.filter((l) => l.active || l.id === search.level);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor={`${idBase}-grade`} className="block text-sm font-semibold text-slate-900">
          {t('grade')}
        </label>
        <Select
          id={`${idBase}-grade`}
          value={search.grade ?? ''}
          // An attente belongs to one grade: choosing another grade lets it go.
          onChange={(e) => go({ grade: e.target.value || null, exp: null })}
        >
          <option value="">{t('anyGrade')}</option>
          {options.grades.map((g) => (
            <option key={g.code} value={g.code}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idBase}-subject`} className="block text-sm font-semibold text-slate-900">
          {t('subject')}
        </label>
        <Select
          id={`${idBase}-subject`}
          value={search.subject ?? ''}
          // Domaines and attentes belong to one subject: choosing another lets them go.
          onChange={(e) => go({ subject: e.target.value || null, strand: null, exp: null })}
        >
          <option value="">{t('anySubject')}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      {types.length ? (
        <Group legend={t('type')}>
          {types.map((type) => (
            <Choice
              key={type}
              type="checkbox"
              name="type"
              label={tc(`types.${type}`)}
              count={facets.type[type] ?? 0}
              checked={search.types.includes(type)}
              onChange={() => go({ types: toggle(search.types, type) })}
            />
          ))}
        </Group>
      ) : null}

      <Group legend={t('bucket')}>
        {LIBRARY_BUCKETS.map((bucket) => (
          <Choice
            key={bucket}
            type="checkbox"
            name="bucket"
            label={tc(`buckets.${bucket}`)}
            count={facets.bucket[bucket] ?? 0}
            checked={search.buckets.includes(bucket)}
            onChange={() => go({ buckets: toggle(search.buckets, bucket) })}
          />
        ))}
      </Group>

      <Group legend={t('duration')}>
        <Choice
          type="radio"
          name={`${idBase}-dur`}
          label={t('anyDuration')}
          checked={search.dur === null}
          onChange={() => go({ dur: null })}
        />
        {DURATION_BANDS.map((band) => (
          <Choice
            key={band}
            type="radio"
            name={`${idBase}-dur`}
            label={tc(`duration.${band}`)}
            count={facets.duration[band]}
            checked={search.dur === band}
            onChange={() => go({ dur: band })}
          />
        ))}
      </Group>

      <Group legend={t('format')}>
        {FORMAT_KEYS.map((format) => (
          <Choice
            key={format}
            type="checkbox"
            name="fmt"
            label={tc(`formats.${format}`)}
            count={facets.format[format]}
            checked={search.fmt.includes(format)}
            onChange={() => go({ fmt: toggle(search.fmt, format) })}
          />
        ))}
      </Group>

      <Group legend={t('more')}>
        <Choice
          type="checkbox"
          name="sub"
          label={t('subFriendly')}
          count={facets.subFriendly}
          checked={search.sub}
          onChange={() => go({ sub: !search.sub })}
        />
        <Choice
          type="checkbox"
          name="approved"
          label={t('approvedOnly')}
          count={facets.approved}
          checked={search.approved}
          onChange={() => go({ approved: !search.approved })}
        />
      </Group>

      {levels.length ? (
        <div className="space-y-1.5">
          <label htmlFor={`${idBase}-level`} className="block text-sm font-semibold text-slate-900">
            {t('level')}
          </label>
          <Select
            id={`${idBase}-level`}
            value={search.level ?? ''}
            aria-describedby={`${idBase}-level-hint`}
            onChange={(e) => go({ level: e.target.value || null })}
          >
            <option value="">{t('anyLevel')}</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {t('levelOption', {
                  label: l.personal ? t('personalLevel', { label: l.label }) : l.label,
                  count: facets.level[l.id] ?? 0,
                })}
              </option>
            ))}
          </Select>
          <p id={`${idBase}-level-hint`} className="text-sm text-slate-600">
            {t('levelHint')}
          </p>
        </div>
      ) : null}

      <Button
        variant="ghost"
        disabled={!hasFilters(search)}
        onClick={() => apply(clearFilters(search))}
      >
        {t('clear')}
      </Button>
    </div>
  );
}

/**
 * « Filtres » on phones: a button (with the number of choices made) that opens the filters in a
 * bottom sheet. Results change behind it as choices are made; « Voir les N ressources » closes
 * it.
 */
export function FacetSheet({ search, facets, options, total }: PanelProps & { total: number }) {
  const t = useTranslations('library.filters');
  const { pending } = useSearchNavigation();
  const [open, setOpen] = useState(false);
  const chosen = facetFilterCount(search);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SlidersHorizontal aria-hidden />
          {chosen ? t('openCount', { count: chosen }) : t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('title')} closeLabel={t('close')}>
        <FacetPanel search={search} facets={facets} options={options} />
        <div className="sticky -bottom-5 -mx-5 mt-4 border-t border-slate-200 bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <Button className="w-full" onClick={() => setOpen(false)} aria-busy={pending}>
            {t('show', { count: total })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
