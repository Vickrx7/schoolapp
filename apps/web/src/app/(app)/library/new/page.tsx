import { isLibraryItemType } from '@lynx/content';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ItemEditor } from '@/components/library/editor/item-editor';
import { TypeGrid } from '@/components/library/type-grid';
import { PageHeader } from '@/components/ui/page';
import { emptyEditorForm } from '@/server/library/editor-form';
import { loadEditorContext } from '@/server/queries/library-authoring';
import { librarySchools, requireSession } from '@/server/session';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const GRADE = /^(K1|K2|[1-8])$/;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('libraryEdit.new');
  return { title: t('title') };
}

/**
 * « Nouvelle ressource » (DECISIONS D-061, D-078): the types by category, then (`?type=`) the
 * editor for a new private draft. For teachers and direction of a library school; `?grade=`,
 * `?subject=` and `?exp=` prefill the curriculum (from « Parcourir le curriculum »).
 */
export default async function NewLibraryItemPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const schools = librarySchools(session);
  if (!schools.length) notFound();
  const [t, tc, locale, params] = await Promise.all([
    getTranslations('libraryEdit.new'),
    getTranslations('libraryCommon'),
    getLocale(),
    searchParams,
  ]);
  const type = first(params.type);
  const grade = first(params.grade);
  const subject = first(params.subject);
  const exp = first(params.exp);
  const prefill = new URLSearchParams();
  if (grade && GRADE.test(grade)) prefill.set('grade', grade);
  if (subject && z.uuid().safeParse(subject).success) prefill.set('subject', subject);
  if (exp && z.uuid().safeParse(exp).success) prefill.set('exp', exp);

  if (!isLibraryItemType(type)) {
    return (
      <div className="space-y-4">
        <PageHeader
          back={
            <Link
              href="/library"
              className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t('back')}
            </Link>
          }
          title={t('title')}
          subtitle={t('intro')}
        />
        <TypeGrid query={prefill.toString()} />
      </div>
    );
  }

  const school = schools[0]!;
  const context0 = await loadEditorContext(session, locale, {
    boardId: school.boardId,
    gradeCodes: [],
    subjectId: null,
  });
  const gradeCodes = prefill.get('grade')
    ? [prefill.get('grade')!]
    : context0.myGrades.length === 1
      ? context0.myGrades
      : [];
  const subjectId = context0.subjects.some((s) => s.id === prefill.get('subject'))
    ? prefill.get('subject')
    : null;
  const context =
    gradeCodes.length && subjectId
      ? await loadEditorContext(session, locale, { boardId: school.boardId, gradeCodes, subjectId })
      : context0;
  const expectationIds = context.expectations.some((e) => e.id === prefill.get('exp'))
    ? [prefill.get('exp')!]
    : [];
  const initial = emptyEditorForm(type, {
    boardId: school.boardId,
    schoolId: school.id,
    gradeCodes,
    subjectId,
    expectationIds,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <Link
            href={`/library/new${prefill.size ? `?${prefill}` : ''}`}
            className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t('otherType')}
          </Link>
        }
        title={t('titleType', { type: tc(`types.${type}`) })}
        subtitle={tc(`typeHints.${type}`)}
      />
      <ItemEditor
        mode="new"
        itemId={null}
        contentRevision={null}
        initial={initial}
        context={context}
        status="draft"
        shared={false}
        boardWide={false}
        requested={false}
        faithReviewed={false}
        faithFlagged={false}
      />
    </div>
  );
}
