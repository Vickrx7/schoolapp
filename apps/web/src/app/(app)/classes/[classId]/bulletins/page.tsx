import { FIRST_NAME_TOKEN } from '@lynx/content';
import { reportDraftKey, type ReportPeriodKind } from '@lynx/domain';
import { BookOpen, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ComposerFilters } from '@/components/report-comments/composer-filters';
import { ReportComposer } from '@/components/report-comments/report-composer';
import { Button } from '@/components/ui/button';
import { Badge, Notice } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import { shortDate } from '@/components/year-plan/year-format';
import { loadClass } from '@/server/queries/classes';
import { loadReportComposer, type ReportComposerData } from '@/server/queries/report-comments';
import { findSchool, hasModule, requireSession } from '@/server/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ classId: string }>;
}): Promise<Metadata> {
  const { classId } = await params;
  const session = await requireSession();
  const [cls, t] = await Promise.all([loadClass(session, classId), getTranslations()]);
  return {
    title: cls ? t('reportComments.metaTitle', { className: cls.name }) : t('reportComments.title'),
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * « Bulletins » (`/classes/[id]/bulletins?period=term1&subject=<id>&bank=<id>`, DECISIONS D-130,
 * D-135): report card comments for a class and a report period, composed per student from a
 * comment bank of the library, in the teacher's browser only. For the class's homeroom and
 * subject teachers at a school with the Library module (never « Soutien »). The server gives the
 * students' first names, the periods, the subjects, the banks and the attentes taught; the
 * comments never come back to it.
 */
export default async function BulletinsPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: SearchParams;
}) {
  const { classId } = await params;
  const session = await requireSession();
  // The layout shows "not found" for a missing class, but pages render at the same time.
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const school = findSchool(session, cls.schoolId);
  if (
    !school ||
    !hasModule(school, 'library') ||
    (cls.myRole !== 'homeroom' && cls.myRole !== 'subject')
  ) {
    notFound();
  }
  const [t, tk, locale, query] = await Promise.all([
    getTranslations('reportComments'),
    getTranslations('reportPeriods.kinds'),
    getLocale(),
    searchParams,
  ]);
  const heading = (
    <div className="min-w-0 space-y-1">
      <h2 className="text-xl font-bold text-slate-900">{t('title')}</h2>
      <p className="max-w-prose text-slate-600">{t('intro')}</p>
    </div>
  );
  const data = await loadReportComposer(session, cls, query, locale);
  if (!data) {
    return (
      <div className="space-y-5">
        {heading}
        <Notice tone="warning">{t('failed')}</Notice>
      </div>
    );
  }

  const periodLabel = (kind: ReportPeriodKind) => {
    const p = data.periods.find((x) => x.kind === kind)!;
    const dates = {
      kind: tk(kind),
      from: shortDate(p.startsOn, locale),
      to: shortDate(p.endsOn, locale),
    };
    return p.dueOn
      ? t('filters.periodOption', { ...dates, due: shortDate(p.dueOn, locale) })
      : t('filters.periodOptionNoDue', dates);
  };
  const periodOptions = [
    ...data.periods.map((p) => ({ value: p.kind, label: periodLabel(p.kind) })),
    { value: 'custom' as const, label: t('filters.custom') },
  ];
  const selection = data.period;
  const chosenPeriodLabel =
    selection.choice === 'custom'
      ? t('filters.customRange', {
          from: shortDate(selection.window.startsOn, locale),
          to: shortDate(selection.window.endsOn, locale),
        })
      : tk(selection.choice);
  const subjectLabel = (key: string) => {
    const choice = data.subjects.find((s) => s.key === key);
    return choice?.subject?.label ?? t('filters.learningSkills');
  };
  const gradeLabel = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    data.grades.map((g) => g.label),
  );
  const subject = subjectLabel(data.subject.key);

  return (
    <ReportComposer
      userId={session.userId}
      classId={classId}
      today={data.today}
      draftKey={reportDraftKey(session.userId, classId, selection.key)}
      expiresOn={selection.expiresOn}
      periodLabel={chosenPeriodLabel}
      report={selection.report}
      subjectKey={data.subject.key}
      subjectLabel={subject}
      scope={data.scope}
      subjectLabels={data.subjects.map((s) => ({ key: s.key, label: subjectLabel(s.key) }))}
      students={data.students}
      grades={data.grades}
      bank={
        data.bank
          ? { id: data.bank.id, revision: data.bank.revision, entries: data.bank.entries }
          : null
      }
      expectations={data.expectations.map((e) => ({
        id: e.id,
        code: e.code,
        gradeCode: e.gradeCode,
        parentId: e.parentId,
      }))}
      taughtIds={data.taughtIds}
      heading={heading}
      top={
        <div className="space-y-3">
          <ComposerFilters
            key={`${selection.key}:${data.subject.key}:${data.bank?.id ?? ''}`}
            classId={classId}
            periods={periodOptions}
            subjects={data.subjects.map((s) => ({
              key: s.key,
              label: subjectLabel(s.key),
              group: s.group,
            }))}
            banks={data.banks.map((b) => ({
              id: b.id,
              // Every bank is one: its title without « Commentaires de bulletin : » fits a phone.
              label: `${b.title.replace(/^commentaires de bulletin\s*:\s*/iu, '')} (${bankStatus(t, b.status)})`,
            }))}
            year={data.year}
            values={{
              period: selection.choice,
              from: selection.choice === 'custom' ? selection.window.startsOn : null,
              to: selection.choice === 'custom' ? selection.window.endsOn : null,
              kind: selection.report,
              subject: data.subject.key,
              bank: data.bank?.id ?? null,
            }}
          />
          {data.periods.length === 0 ? <Notice tone="info">{t('filters.noPeriods')}</Notice> : null}
          {selection.invalid ? <Notice tone="warning">{t('filters.customInvalid')}</Notice> : null}
          <BankPanel data={data} subject={subject} grade={gradeLabel} />
          <TaughtPanel data={data} />
        </div>
      }
      help={<Help />}
      empty={
        <EmptyState
          title={t('students.empty')}
          action={
            <Button asChild variant="secondary">
              <Link href={`/classes/${classId}/students`}>{t('students.add')}</Link>
            </Button>
          }
        />
      }
    />
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'reportComments'>>>;

const bankStatus = (t: T, status: string) =>
  status === 'board_approved'
    ? t('bank.approved')
    : status === 'teacher_reviewed'
      ? t('bank.reviewed')
      : t('bank.draft');

/** The bank chosen, with its status and « Voir la banque », or how to make one. */
async function BankPanel({
  data,
  subject,
  grade,
}: {
  data: ReportComposerData;
  subject: string;
  grade: string;
}) {
  const t = await getTranslations('reportComments');
  if (data.bankUnreadable) return <Notice tone="warning">{t('bank.unreadable')}</Notice>;
  const bank = data.bank;
  if (!bank) {
    return (
      <div
        className="rounded-xl border border-dashed border-slate-300 bg-white p-5"
        data-testid="no-bank"
      >
        <p className="font-medium text-slate-900">{t('bank.none', { subject, grade })}</p>
        <p className="mt-1 text-sm text-slate-600">{t('bank.noneHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.aiBankHref ? (
            <Button asChild>
              <Link href={data.aiBankHref}>
                <Sparkles aria-hidden />
                {t('bank.createAi')}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link href={data.newBankHref}>{t('bank.create')}</Link>
          </Button>
        </div>
      </div>
    );
  }
  const approved = bank.status === 'board_approved';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex min-w-0 items-start gap-2">
          <BookOpen className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
          <span className="font-medium text-slate-900">{bank.title}</span>
        </span>
        <Badge
          tone={approved ? 'success' : bank.status === 'teacher_reviewed' ? 'neutral' : 'warning'}
        >
          {bankStatus(t, bank.status)}
        </Badge>
        <Link
          href={`/library/items/${bank.id}`}
          className="inline-flex min-h-11 items-center font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          {t('bank.view')}
        </Link>
      </div>
      {bank.status === 'draft' || bank.status === 'rejected' ? (
        <Notice tone="warning">{t('bank.draftWarning')}</Notice>
      ) : null}
    </div>
  );
}

/** « Attentes enseignées pendant la période (9) », from the class's own units and lessons. */
async function TaughtPanel({ data }: { data: ReportComposerData }) {
  const t = await getTranslations('reportComments.taught');
  if (data.scope === 'learning_skills') return null;
  // Without a bank, nothing is « proposé »: the sentence stops at the attentes.
  const bank = data.bank !== null;
  if (data.taughtIds === null) {
    return <p className="text-sm text-slate-600">{bank ? t('notLoaded') : t('notLoadedNoBank')}</p>;
  }
  if (data.taughtIds.length === 0) {
    return <p className="text-sm text-slate-600">{bank ? t('none') : t('noneNoBank')}</p>;
  }
  const taught = new Set(data.taughtIds);
  const rows = data.expectations.filter((e) => taught.has(e.id));
  const several = data.grades.length > 1;
  return (
    <details className="rounded-xl border border-slate-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-slate-900">
        {t('summary', { count: rows.length })}
      </summary>
      <div className="space-y-2 px-4 pb-4">
        <p className="text-sm text-slate-600">{t('intro')}</p>
        <ul className="space-y-1 text-sm">
          {rows.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="shrink-0 font-semibold text-slate-900 tabular-nums">{e.code}</span>
              <span className="text-slate-700">
                {e.text}
                {several ? <span className="text-slate-500"> · {e.gradeLabel}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** « Comment ça marche ». */
async function Help() {
  const t = await getTranslations('reportComments.help');
  const items = ['device', 'name', 'banks', 'taught', 'copy', 'erase', 'spellcheck'] as const;
  return (
    <details className="rounded-xl border border-slate-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-slate-900">
        {t('summary')}
      </summary>
      <ul className="list-disc space-y-1.5 px-4 pb-4 pl-9 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item}>{item === 'name' ? t('name', { token: FIRST_NAME_TOKEN }) : t(item)}</li>
        ))}
      </ul>
    </details>
  );
}
