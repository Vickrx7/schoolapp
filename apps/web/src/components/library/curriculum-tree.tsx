import { ChevronRight, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Badge } from '@/components/ui/card';
import type {
  CurriculumExpectationView,
  CurriculumStrandView,
} from '@/server/library/curriculum-tree';
import { libraryHref } from '@/server/library/search-params';

interface Scope {
  gradeCode: string;
  subjectId: string;
  /** « Créer avec l’IA pour cette attente » (AI on for one of the user's library schools). */
  canGenerate: boolean;
}

/**
 * The attentes of a grade and subject (D-069), one disclosure per domaine (« Domaine C —
 * Compréhension… »): each overall attente, then its specific attentes, with « À vérifier » while
 * the text is a summary (D-030), the number of resources and approved ones (a link to them), and
 * « Créer avec l’IA pour cette attente » where AI is on.
 */
export function CurriculumTree({
  strands,
  gradeCode,
  subjectId,
  canGenerate,
}: Scope & { strands: readonly CurriculumStrandView[] }) {
  const t = useTranslations('library.curriculum');
  const scope = { gradeCode, subjectId, canGenerate };
  return (
    <div className="space-y-3">
      {strands.map((strand) => (
        <details
          key={strand.id ?? 'none'}
          className="group rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 p-4 font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-5 shrink-0 text-slate-500 transition-transform group-open:rotate-90"
              aria-hidden
            />
            {strand.code && strand.label
              ? t('strand', { code: strand.code, label: strand.label })
              : t('otherStrand')}
          </summary>
          <div className="space-y-3 border-t border-slate-200 p-4">
            {strand.id ? (
              <Link
                href={libraryHref({ grade: gradeCode, subject: subjectId, strand: strand.id })}
                className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
              >
                {t('seeStrand')}
              </Link>
            ) : null}
            <ul className="space-y-3">
              {strand.expectations.map((e) => (
                <ExpectationRow key={e.id} expectation={e} scope={scope} />
              ))}
            </ul>
          </div>
        </details>
      ))}
    </div>
  );
}

function ExpectationRow({
  expectation: e,
  scope,
}: {
  expectation: CurriculumExpectationView;
  scope: Scope;
}) {
  const t = useTranslations('library.curriculum');
  const tc = useTranslations('libraryCommon');
  const counts =
    e.itemCount === 0 ? t('none') : t('counts', { count: e.itemCount, approved: e.approvedCount });
  return (
    <li className={e.kind === 'overall' ? 'rounded-lg border border-slate-200 p-3' : 'py-1'}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-slate-900">{e.code}</span>
        <span className="text-xs text-slate-600">{tc(`expectationKinds.${e.kind}`)}</span>
        {e.verified ? null : <Badge tone="warning">{tc('badges.toVerify')}</Badge>}
      </p>
      <p className="mt-1 text-sm text-slate-800">{e.text}</p>
      <p className="mt-1 flex flex-wrap gap-x-4">
        <Link
          href={libraryHref({ grade: scope.gradeCode, subject: scope.subjectId, exp: e.id })}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
        >
          <span className="sr-only">{e.code}, </span>
          {counts}
        </Link>
        {scope.canGenerate ? (
          <Link
            href={`/library/generate?exp=${e.id}`}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            <Sparkles className="size-4" aria-hidden />
            {t('createWithAi')}
            <span className="sr-only"> ({e.code})</span>
          </Link>
        ) : null}
      </p>
      {e.children.length ? (
        <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
          {e.children.map((c) => (
            <ExpectationRow key={c.id} expectation={c} scope={scope} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
