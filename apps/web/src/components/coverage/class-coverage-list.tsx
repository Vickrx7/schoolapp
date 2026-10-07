import type { CoverageEvidence, CoverageStatus } from '@lynx/domain';
import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  Clock,
  History,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/card';
import { longDate, shortRange } from '@/components/year-plan/year-format';
import type {
  ClassCoverageEntry,
  ClassCoverageItem,
  ClassCoverageView,
} from '@/server/planning/coverage-view';

const STATUS: Record<CoverageStatus, { icon: LucideIcon; tone: 'success' | 'brand' | 'neutral' }> =
  {
    taught: { icon: CircleCheck, tone: 'success' },
    taught_pending: { icon: Clock, tone: 'success' },
    taught_unit: { icon: CircleCheck, tone: 'success' },
    planned: { icon: CalendarClock, tone: 'brand' },
    taught_earlier: { icon: History, tone: 'neutral' },
    not_planned: { icon: CircleDashed, tone: 'neutral' },
  };

/** An attente's status in words, with an icon (never colour alone). */
export function CoverageStatusChip({ status }: { status: CoverageStatus }) {
  const t = useTranslations('classCoverage.status');
  const { icon: Icon, tone } = STATUS[status];
  return (
    <Badge tone={tone} className="text-sm">
      <Icon className="size-4" aria-hidden />
      {t(status)}
    </Badge>
  );
}

/**
 * A class's attentes by domaine (DECISIONS D-125): each overall attente with specific attentes a
 * heading for them (« 2 sur 3 enseignées »), every other attente with its status (« Enseignée »,
 * « Enseignée (à confirmer) », « Enseignée (unité terminée) », « Prévue », « Enseignée avant la
 * période », « Pas encore prévue ») and its evidence: the lessons given (« 2 leçons données
 * (dernière le 14 oct.) »), those a substitute reported, and the units, each a link to its page.
 * « À vérifier » while an attente's text is a summary (D-030).
 */
export function ClassCoverageList({ classId, view }: { classId: string; view: ClassCoverageView }) {
  const t = useTranslations('classCoverage.list');
  const tl = useTranslations('library.curriculum');
  return (
    <div className="space-y-6">
      {view.groups.map((group) => {
        const id = `class-coverage-${group.strand?.id ?? 'other'}`;
        const { taught, total } = group.counts;
        return (
          <section key={id} aria-labelledby={id} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h4 id={id} className="text-base font-semibold text-slate-900">
                {group.strand
                  ? tl('strand', { code: group.strand.code, label: group.strand.label })
                  : tl('otherStrand')}
              </h4>
              <p className="text-sm text-slate-600 tabular-nums">
                {t('overallCount', { taught, total })}
              </p>
            </div>
            <ul className="space-y-3">
              {group.entries.map((entry) => (
                <Entry key={entry.expectation.expectationId} classId={classId} entry={entry} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Entry({ classId, entry }: { classId: string; entry: ClassCoverageEntry }) {
  const t = useTranslations('classCoverage.list');
  const e = entry.expectation;
  if (e.unit) return <Item classId={classId} expectation={e} />;
  return (
    <li>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <Heading expectation={e} />
        <p className="mt-1 text-sm text-slate-700">
          {t('overallCount', { taught: entry.childTaught, total: entry.childCount })}
        </p>
      </div>
      {entry.children.length ? (
        <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
          {entry.children.map((c) => (
            <Item key={c.expectationId} classId={classId} expectation={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Heading({
  expectation: e,
  status,
}: {
  expectation: ClassCoverageItem;
  /** The attente's status, beside its code (a heading has none). */
  status?: ReactNode;
}) {
  const tc = useTranslations('libraryCommon');
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-900">{e.code}</span>
          <span className="text-xs text-slate-600">{tc(`expectationKinds.${e.kind}`)}</span>
          {e.verified ? null : <Badge tone="warning">{tc('badges.toVerify')}</Badge>}
        </p>
        {status}
      </div>
      <p className="mt-1 text-sm text-slate-800">{e.text}</p>
    </>
  );
}

function Item({ classId, expectation: e }: { classId: string; expectation: ClassCoverageItem }) {
  return (
    <li
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      data-testid="coverage-expectation"
      data-code={e.code}
    >
      <Heading expectation={e} status={<CoverageStatusChip status={e.status} />} />
      <Evidence classId={classId} evidence={e.evidence} />
    </li>
  );
}

function Evidence({ classId, evidence }: { classId: string; evidence: CoverageEvidence }) {
  const t = useTranslations('classCoverage.evidence');
  const locale = useLocale();
  const lines: ReactNode[] = [];
  if (evidence.lessonsTaught > 0) {
    lines.push(
      evidence.lastTaughtOn
        ? t('lessons', {
            count: evidence.lessonsTaught,
            date: longDate(evidence.lastTaughtOn, locale),
          })
        : t('lessonsNoDate', { count: evidence.lessonsTaught }),
    );
  }
  if (evidence.lessonsPending > 0) lines.push(t('pending', { count: evidence.lessonsPending }));
  for (const unit of evidence.units) {
    const text =
      unit.startsOn && unit.endsOn
        ? t('unit', { title: unit.title, dates: shortRange(unit.startsOn, unit.endsOn, locale) })
        : t('unitNoDates', { title: unit.title });
    lines.push(
      <Link
        href={`/classes/${classId}/planning/${unit.id}`}
        className="inline-flex min-h-11 items-center text-brand-700 underline underline-offset-2 md:min-h-0"
      >
        {text}
      </Link>,
    );
  }
  if (lines.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}
