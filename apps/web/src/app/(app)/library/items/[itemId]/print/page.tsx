import { TYPE_INFO, type RenderedDoc } from '@lynx/content';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PrintOptions } from '@/components/library/print-options';
import { PrintSheets } from '@/components/library/print-sheets';
import { PdfSlot } from '@/components/library/slots/pdf-slot';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { studentVersionDocs, teacherVersionDocs } from '@/server/library/item-docs';
import { parsePrintParams, selectVersions } from '@/server/library/view-model';
import { loadItemForStudentSheet, loadItemKeys, loadLibraryItem } from '@/server/queries/library';
import { getSession, requireSession, showLibrary } from '@/server/session';

type Props = {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ doc?: string | string[]; v?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations('libraryItem.print');
  const { itemId } = await params;
  const session = await getSession();
  if (!session || !z.uuid().safeParse(itemId).success) return { title: t('title') };
  const item = await loadLibraryItem(itemId, session, await getLocale());
  return { title: item ? `${t('title')} — ${item.title}` : t('title') };
}

/**
 * « Impression » (`?doc=student|teacher&v=<versionIds>`, DECISIONS D-042, D-062, D-075): one
 * version per page with its small number and never a level name. The student sheet is printed
 * from `loadItemForStudentSheet`, which never reads answer keys; the teacher document is the
 * guide of the first chosen version, then « Corrigé — version n » for each chosen version. The
 * options (and the legend of the numbers) are on screen only.
 */
export default async function LibraryPrintPage({ params, searchParams }: Props) {
  const session = await requireSession();
  if (!showLibrary(session)) notFound();
  const { itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  const locale = await getLocale();
  // Labels for the options only (screen); no key is read here.
  const item = await loadLibraryItem(itemId, session, locale);
  if (!item) notFound();
  const [t, query] = await Promise.all([getTranslations('libraryItem'), searchParams]);

  const hasStudentSheet = TYPE_INFO[item.type].audience !== 'teacher';
  const parsed = parsePrintParams(query);
  const doc = hasStudentSheet ? parsed.doc : 'teacher';
  const chosen = selectVersions(item.versions, parsed.versionIds);
  const chosenIds = chosen.map((v) => v.id);

  const sheets: { key: string; doc: RenderedDoc }[] = [];
  let partial = false;
  if (doc === 'student') {
    const source = await loadItemForStudentSheet(item.id, chosenIds);
    if (!source) notFound();
    for (const version of source.versions) {
      const docs = studentVersionDocs(source, version);
      partial ||= docs.partial;
      if (docs.student) sheets.push({ key: version.id, doc: docs.student });
    }
  } else {
    const keys = await loadItemKeys(item.id, chosenIds);
    chosen.forEach((version, i) => {
      const docs = teacherVersionDocs(item, version, keys.get(version.id));
      partial ||= docs.partial;
      // The guide once (the first chosen version), then each version's key on its own page.
      if (i === 0 && docs.teacher) sheets.push({ key: `${version.id}:guide`, doc: docs.teacher });
      if (docs.answerKey) sheets.push({ key: `${version.id}:key`, doc: docs.answerKey });
    });
  }

  const labels = item.versions.map((v) => ({
    id: v.id,
    number: v.number,
    label:
      v.languageLevelId === null
        ? t('versions.base')
        : v.levelLabel === null
          ? t('versions.otherLevel')
          : v.personalLevel
            ? t('versions.personal', { label: v.levelLabel })
            : v.levelLabel,
  }));
  const backTab = doc === 'teacher' ? 'teacher' : 'student';
  const back = `/library/items/${item.id}${chosenIds[0] ? `?v=${chosenIds[0]}&tab=${backTab}` : ''}`;

  return (
    <div className="space-y-6">
      <div className="space-y-4 print:hidden">
        <PageHeader
          back={
            <Link
              href={back}
              className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t('print.back')}
            </Link>
          }
          title={t('print.title')}
          subtitle={item.title}
        />
        <Card>
          <CardBody className="pt-4">
            <PrintOptions
              basePath={`/library/items/${item.id}/print`}
              doc={doc}
              versions={labels}
              selected={chosenIds}
              hasStudentSheet={hasStudentSheet}
              pdf={<PdfSlot item={item} versionIds={chosenIds} />}
            />
          </CardBody>
        </Card>
      </div>
      <PrintSheets sheets={sheets} partial={partial} />
    </div>
  );
}
