import { TYPE_INFO } from '@lynx/content';
import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { AnswerKeyReveal } from '@/components/library/answer-key-reveal';
import { DocView } from '@/components/library/doc-view';
import { ItemDetails } from '@/components/library/item-details';
import { ItemHeader } from '@/components/library/item-header';
import { isItemTab, type ItemTab } from '@/components/library/item-tabs';
import { ItemViewer } from '@/components/library/item-viewer';
import { LevelsAiSlot } from '@/components/library/slots/levels-ai-slot';
import { PdfSlot } from '@/components/library/slots/pdf-slot';
import { PlanningSlot } from '@/components/library/slots/planning-slot';
import { WorkflowSlot } from '@/components/library/slots/workflow-slot';
import type { VersionChoice } from '@/components/library/version-picker';
import { Notice } from '@/components/ui/card';
import {
  studentVersionDocs,
  teacherVersionDocs,
  type StudentVersionDocs,
  type TeacherVersionDocs,
} from '@/server/library/item-docs';
import { printHref } from '@/server/library/view-model';
import { loadItemKeys, loadLibraryItem } from '@/server/queries/library';
import { getSession, requireSession, showLibrary } from '@/server/session';

type Props = {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ v?: string | string[]; tab?: string | string[] }>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations('libraryItem');
  const { itemId } = await params;
  const session = await getSession();
  if (!session || !z.uuid().safeParse(itemId).success) return { title: t('title') };
  const item = await loadLibraryItem(itemId, session, await getLocale());
  return { title: item?.title ?? t('title') };
}

function StudentPanel({ docs, noSheet }: { docs: StudentVersionDocs; noSheet: string }) {
  return (
    <div className="space-y-4">
      {docs.partial ? <PartialNotice /> : null}
      {docs.student ? (
        <DocView doc={docs.student} />
      ) : docs.partial ? null : (
        <p className="text-slate-700">{noSheet}</p>
      )}
    </div>
  );
}

function TeacherPanel({ docs }: { docs: TeacherVersionDocs }) {
  return (
    <div className="space-y-4">
      {docs.partial ? <PartialNotice /> : null}
      {docs.teacher ? <DocView doc={docs.teacher} /> : null}
      {docs.answerKey ? (
        <AnswerKeyReveal>
          <DocView doc={docs.answerKey} />
        </AnswerKeyReveal>
      ) : null}
    </div>
  );
}

function PartialNotice() {
  const t = useTranslations('libraryItem');
  return <Notice tone="warning">{t('partial')}</Notice>;
}

/**
 * « Fiche de la ressource » (DECISIONS D-062, D-065, D-075): the item for anyone who can read it
 * (row level security; not found otherwise), with its versions, « Pour les élèves » (never a
 * key or a teacher note), « Guide et corrigé » (the key collapsed until asked for) and
 * « Détails ». Library screens need a library school or a reviewer designation (D-078); office
 * staff have none.
 */
export default async function LibraryItemPage({ params, searchParams }: Props) {
  const session = await requireSession();
  if (!showLibrary(session)) notFound();
  const { itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  const locale = await getLocale();
  const item = await loadLibraryItem(itemId, session, locale);
  if (!item) notFound();

  const [t, format, keys, query] = await Promise.all([
    getTranslations('libraryItem'),
    getFormatter(),
    loadItemKeys(
      item.id,
      item.versions.map((v) => v.id),
    ),
    searchParams,
  ]);

  const hasStudentSheet = TYPE_INFO[item.type].audience !== 'teacher';
  const wantedVersion = first(query.v);
  const initialVersionId =
    item.versions.find((v) => v.id === wantedVersion)?.id ?? item.versions[0]?.id ?? '';
  const wantedTab = first(query.tab);
  const initialTab: ItemTab = isItemTab(wantedTab)
    ? wantedTab
    : hasStudentSheet
      ? 'student'
      : 'teacher';

  const versions: VersionChoice[] = item.versions.map((v) => ({
    id: v.id,
    label:
      v.languageLevelId === null
        ? t('versions.base')
        : v.levelLabel === null
          ? t('versions.otherLevel')
          : v.personalLevel
            ? t('versions.personal', { label: v.levelLabel })
            : v.levelLabel,
  }));
  const studentSource = {
    type: item.type,
    title: item.title,
    faith: { connection: item.faith.connection, onStudentSheet: item.faith.onStudentSheet },
  };
  const student: Record<string, ReactNode> = {};
  const teacher: Record<string, ReactNode> = {};
  const printLinks: Record<string, { student: string; teacher: string }> = {};
  const versionActions: Record<string, ReactNode> = {};
  for (const v of item.versions) {
    student[v.id] = (
      <StudentPanel docs={studentVersionDocs(studentSource, v)} noSheet={t('noStudentSheet')} />
    );
    teacher[v.id] = <TeacherPanel docs={teacherVersionDocs(item, v, keys.get(v.id))} />;
    printLinks[v.id] = {
      student: printHref(item.id, 'student', [v.id]),
      teacher: printHref(item.id, 'teacher', [v.id]),
    };
    versionActions[v.id] = <PdfSlot item={item} versionIds={[v.id]} />;
  }

  const date = (instant: string) =>
    format.dateTime(new Date(instant), { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-5">
      <ItemHeader item={item} />

      {item.source === 'ai_generated' && item.status === 'draft' && item.mine ? (
        <Notice>{t('aiDraft')}</Notice>
      ) : null}
      {item.status === 'archived' ? <Notice tone="warning">{t('archived')}</Notice> : null}
      {item.review?.note && item.status === 'rejected' ? (
        <Notice tone="warning" className="whitespace-pre-line">
          {t('sentBack', { note: item.review.note })}
        </Notice>
      ) : null}
      {item.review?.requestedAt ? (
        <Notice>{t('awaiting', { date: date(item.review.requestedAt) })}</Notice>
      ) : null}

      <WorkflowSlot item={item} />

      {item.versions.length ? (
        <ItemViewer
          versions={versions}
          initialVersionId={initialVersionId}
          initialTab={initialTab}
          hasStudentSheet={hasStudentSheet}
          student={student}
          teacher={teacher}
          details={<ItemDetails item={item} />}
          printLinks={printLinks}
          versionActions={versionActions}
          belowPicker={<LevelsAiSlot item={item} />}
          actions={<PlanningSlot item={item} />}
        />
      ) : (
        // Every item has a base version; if none can be read, the details still can.
        <div className="space-y-4">
          <Notice tone="warning">{t('partial')}</Notice>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <ItemDetails item={item} />
          </div>
        </div>
      )}
    </div>
  );
}
