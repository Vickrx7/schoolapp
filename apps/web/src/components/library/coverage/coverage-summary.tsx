import { useTranslations } from 'next-intl';
import Link from 'next/link';
// Relative imports and no `@/` alias, so the table is drawn in unit tests (coverage-list.test.ts).
import { cn } from '../../../lib/utils';
import {
  coverageHref,
  withAnyApproved,
  type CoverageFilter,
  type CoverageSummaryView,
} from '../../../server/library/coverage-view';

/**
 * « Vue d’ensemble » (DECISIONS D-094): one row per grade and one column per subject that has
 * attentes, each cell « 14 sur 22 » (attentes with at least one approved resource, out of all)
 * and how many have none, linking to that grade and subject's list. The table scrolls sideways in
 * its own container on a phone, so the page never does; the cell being shown is marked.
 */
export function CoverageSummary({
  summary,
  current,
  show,
  min,
}: {
  summary: CoverageSummaryView;
  /** The grade and subject whose list is shown below. */
  current: { grade: string | null; subject: string | null };
  show: CoverageFilter;
  min: number;
}) {
  const t = useTranslations('libraryCoverage.summary');
  if (!summary.grades.length) return <p className="text-sm text-slate-600">{t('empty')}</p>;
  return (
    <div
      role="region"
      aria-labelledby="coverage-summary-caption"
      // Focusable so the keyboard can scroll it when it is wider than the screen. `relative`
      // keeps the cells' screen-reader text (absolutely placed) inside the scrolling box: without
      // it, that text sits past the right edge of a phone screen and the page scrolls sideways.
      tabIndex={0}
      className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
    >
      <table className="w-full min-w-max border-collapse text-sm">
        <caption
          id="coverage-summary-caption"
          className="px-4 pt-3 pb-2 text-left text-sm text-slate-600"
        >
          {t('caption')}
        </caption>
        <thead>
          <tr className="border-y border-slate-200 bg-slate-50">
            <th scope="col" className="px-4 py-2 text-left font-medium text-slate-700">
              {t('grade')}
            </th>
            {summary.subjects.map((s) => (
              <th key={s.id} scope="col" className="px-3 py-2 text-left font-medium text-slate-700">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.grades.map(({ grade, cells }) => (
            <tr key={grade.code} className="border-b border-slate-100 last:border-0">
              <th
                scope="row"
                className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-900"
              >
                {grade.label}
              </th>
              {cells.map((cell, i) => {
                const subject = summary.subjects[i]!;
                if (!cell) {
                  return (
                    <td key={subject.id} className="px-3 py-2 text-slate-500">
                      <span aria-hidden>—</span>
                      <span className="sr-only">{t('notLoaded')}</span>
                    </td>
                  );
                }
                const covered = withAnyApproved(cell);
                const here = current.grade === grade.code && current.subject === subject.id;
                return (
                  <td key={subject.id} className="px-1 py-1">
                    <Link
                      href={coverageHref({ grade: grade.code, subject: subject.id, show, min })}
                      aria-current={here ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 min-w-24 flex-col justify-center rounded-lg px-2 py-1 hover:bg-brand-50',
                        here && 'bg-brand-50 ring-2 ring-brand-600',
                      )}
                    >
                      <span aria-hidden className="font-semibold text-slate-900 tabular-nums">
                        {t('cell', { covered, total: cell.units })}
                      </span>
                      {cell.none > 0 ? (
                        <span aria-hidden className="text-xs text-slate-600 tabular-nums">
                          {t('without', { count: cell.none })}
                        </span>
                      ) : null}
                      <span className="sr-only">
                        {t('cellLabel', {
                          subject: subject.label,
                          grade: grade.label,
                          covered,
                          total: cell.units,
                        })}
                        {cell.none > 0 ? ` (${t('without', { count: cell.none })})` : ''}
                      </span>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
