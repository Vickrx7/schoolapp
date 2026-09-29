import { CircleAlert, CircleCheck, CircleDashed, Plus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
// Relative imports and no `@/` alias, so the list is drawn in unit tests (coverage-list.test.ts).
import {
  withAnyApproved,
  type CoverageEntry,
  type CoverageExpectation,
  type CoverageView,
} from '../../../server/library/coverage-view';
import { libraryHref } from '../../../server/library/search-params';

export interface CoverageScope {
  gradeCode: string;
  subjectId: string;
  /** « Créer une ressource » (the user creates at a library school). */
  canCreate: boolean;
  /** « Créer avec l’IA pour cette attente » (AI on for one of the user's library schools). */
  canGenerate: boolean;
}

const LINK =
  'inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline';

const TONES = {
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
} as const;

/** The look of `Badge` (components/ui/card), whose `@/` import the unit tests cannot follow. */
function Tag({
  tone,
  size = 'sm',
  children,
}: {
  tone: keyof typeof TONES;
  size?: 'xs' | 'sm';
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
        size === 'xs' ? 'text-xs' : 'text-sm'
      } ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The attentes of a grade and subject by domaine (DECISIONS D-094): each overall attente that has
 * specific attentes is a heading for them; every other attente shows how many board-approved
 * resources it has (« Aucune ressource approuvée », « Peu : 1 ressource approuvée »,
 * « 3 ressources approuvées », told apart by words and an icon, not only colour), « 2 en
 * révision » for the board's content reviewers, the types already there, « À vérifier » while
 * its text is a summary (D-030), and the next steps: « Voir les ressources approuvées », and for
 * attentes without enough, « Créer une ressource » and « Créer avec l’IA pour cette attente ».
 */
export function CoverageList({ view, scope }: { view: CoverageView; scope: CoverageScope }) {
  const t = useTranslations('libraryCoverage.list');
  const tb = useTranslations('library.curriculum');
  return (
    <div className="space-y-6">
      {view.groups.map((group) => {
        const id = `coverage-strand-${group.strand?.id ?? 'other'}`;
        const covered = withAnyApproved(group.counts);
        return (
          <section key={id} aria-labelledby={id} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id={id} className="text-base font-semibold text-slate-900">
                {group.strand
                  ? tb('strand', { code: group.strand.code, label: group.strand.label })
                  : tb('otherStrand')}
              </h3>
              <p className="text-sm text-slate-600 tabular-nums">
                <span aria-hidden>{t('strandCount', { covered, total: group.counts.units })}</span>
                <span className="sr-only">
                  {t('strandCountLabel', { covered, total: group.counts.units })}
                </span>
              </p>
            </div>
            <ul className="space-y-3">
              {group.entries.map((entry) => (
                <Entry key={entry.expectation.expectationId} entry={entry} scope={scope} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Entry({ entry, scope }: { entry: CoverageEntry; scope: CoverageScope }) {
  const t = useTranslations('libraryCoverage.status');
  const e = entry.expectation;
  if (e.unit) return <Unit expectation={e} scope={scope} />;
  // An overall attente with specific attentes: a heading for them, with its own count (itself
  // and its specific attentes, each resource once).
  return (
    <li>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <Heading expectation={e} />
        <p className="mt-1 text-sm text-slate-600">{t('overall', { count: e.approvedCount })}</p>
      </div>
      {entry.children.length ? (
        <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
          {entry.children.map((c) => (
            <Unit key={c.expectationId} expectation={c} scope={scope} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Heading({ expectation: e }: { expectation: CoverageExpectation }) {
  const tc = useTranslations('libraryCommon');
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-slate-900">{e.code}</span>
        <span className="text-xs text-slate-600">{tc(`expectationKinds.${e.kind}`)}</span>
        {e.verified ? null : (
          <Tag tone="warning" size="xs">
            {tc('badges.toVerify')}
          </Tag>
        )}
      </p>
      <p className="mt-1 text-sm text-slate-800">{e.text}</p>
    </>
  );
}

function Unit({
  expectation: e,
  scope,
}: {
  expectation: CoverageExpectation;
  scope: CoverageScope;
}) {
  const t = useTranslations('libraryCoverage');
  const tc = useTranslations('libraryCommon');
  const needsMore = e.level !== 'covered';
  const links = [
    e.approvedCount > 0 ? (
      <Link
        key="see"
        href={libraryHref({
          grade: scope.gradeCode,
          subject: scope.subjectId,
          exp: e.expectationId,
          approved: true,
        })}
        className={LINK}
      >
        {t('see')}
        <span className="sr-only"> ({e.code})</span>
      </Link>
    ) : null,
    needsMore && scope.canCreate ? (
      <Link
        key="create"
        href={`/library/new?${new URLSearchParams({
          grade: scope.gradeCode,
          subject: scope.subjectId,
          exp: e.expectationId,
        }).toString()}`}
        className={LINK}
      >
        <Plus className="size-4" aria-hidden />
        {t('create')}
        <span className="sr-only"> ({e.code})</span>
      </Link>
    ) : null,
    needsMore && scope.canGenerate ? (
      <Link key="ai" href={`/library/generate?exp=${e.expectationId}`} className={LINK}>
        <Sparkles className="size-4" aria-hidden />
        {t('createAi')}
        <span className="sr-only"> ({e.code})</span>
      </Link>
    ) : null,
  ].filter(Boolean);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <Heading expectation={e} />
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <LevelTag expectation={e} />
        {e.inReviewCount ? (
          <Tag tone="brand">{t('inReview', { count: e.inReviewCount })}</Tag>
        ) : null}
      </p>
      {e.approvedTypes.length ? (
        <p className="mt-1 text-xs text-slate-600">
          {t('types', { types: e.approvedTypes.map((type) => tc(`types.${type}`)).join(', ') })}
        </p>
      ) : null}
      {links.length ? <p className="mt-1 flex flex-wrap gap-x-4">{links}</p> : null}
    </li>
  );
}

function LevelTag({ expectation: e }: { expectation: CoverageExpectation }) {
  const t = useTranslations('libraryCoverage.status');
  if (e.level === 'none') {
    return (
      <Tag tone="danger">
        <CircleDashed className="size-4" aria-hidden />
        {t('none')}
      </Tag>
    );
  }
  if (e.level === 'few') {
    return (
      <Tag tone="warning">
        <CircleAlert className="size-4" aria-hidden />
        {t('few', { count: e.approvedCount })}
      </Tag>
    );
  }
  return (
    <Tag tone="success">
      <CircleCheck className="size-4" aria-hidden />
      {t('approved', { count: e.approvedCount })}
    </Tag>
  );
}
