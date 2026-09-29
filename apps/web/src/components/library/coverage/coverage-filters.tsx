'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  COVERAGE_FILTERS,
  COVERAGE_MIN_RANGE,
  coverageHref,
  type CoverageFilter,
} from '@/server/library/coverage-view';

interface Props {
  grade: string;
  subject: string;
  show: CoverageFilter;
  min: number;
}

const THRESHOLDS = Array.from(
  { length: COVERAGE_MIN_RANGE.max - COVERAGE_MIN_RANGE.min + 1 },
  (_, i) => COVERAGE_MIN_RANGE.min + i,
);

/**
 * The list's filters (DECISIONS D-094): « Sans ressource approuvée / Peu de ressources / Toutes »
 * and « Seuil » (1 to 5; fewer approved resources than the threshold is « Peu »). Links in the
 * address, so a filtered list can be shared and reloaded; beside the list on larger screens, in
 * a bottom sheet on phones. Choosing keeps the page where it is.
 */
export function CoverageFilters(props: Props) {
  const t = useTranslations('libraryCoverage.filters');
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden md:block">
        <FilterRows {...props} idPrefix="coverage-filters" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary">
              <SlidersHorizontal aria-hidden />
              {t('open')}
            </Button>
          </DialogTrigger>
          <DialogContent title={t('title')} closeLabel={t('close')}>
            <FilterRows {...props} idPrefix="coverage-sheet" onPick={() => setOpen(false)} />
            <div className="sticky -bottom-5 -mx-5 mt-4 border-t border-slate-200 bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <Button className="w-full" onClick={() => setOpen(false)}>
                {t('done')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {/* What the list shows now, beside the button (it wraps on a narrow phone). */}
        <p className="text-sm text-slate-600">
          {t(`show.${props.show}`)} · {t('threshold')} {props.min}
        </p>
      </div>
    </>
  );
}

function FilterRows({
  grade,
  subject,
  show,
  min,
  idPrefix,
  onPick,
}: Props & { idPrefix: string; onPick?: () => void }) {
  const t = useTranslations('libraryCoverage.filters');
  return (
    <div className="space-y-3">
      <ChipRow
        id={`${idPrefix}-show`}
        label={t('showLabel')}
        chips={COVERAGE_FILTERS.map((value) => ({
          key: value,
          label: t(`show.${value}`),
          href: coverageHref({ grade, subject, show: value, min }),
          current: value === show,
        }))}
        onPick={onPick}
      />
      <ChipRow
        id={`${idPrefix}-min`}
        label={t('threshold')}
        hint={t('thresholdHint')}
        chips={THRESHOLDS.map((value) => ({
          key: String(value),
          label: String(value),
          href: coverageHref({ grade, subject, show, min: value }),
          current: value === min,
        }))}
        onPick={onPick}
      />
    </div>
  );
}

function ChipRow({
  id,
  label,
  hint,
  chips,
  onPick,
}: {
  id: string;
  label: string;
  hint?: string;
  chips: { key: string; label: string; href: string; current: boolean }[];
  onPick?: () => void;
}) {
  return (
    <div className="space-y-2">
      <p id={id} className="text-sm font-medium text-slate-700">
        {label}
      </p>
      <ul
        aria-labelledby={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="flex flex-wrap gap-2"
      >
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href}
              scroll={false}
              replace
              aria-current={chip.current ? 'true' : undefined}
              onClick={onPick}
              className={cn(
                'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm font-medium',
                chip.current
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {chip.label}
            </Link>
          </li>
        ))}
      </ul>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
