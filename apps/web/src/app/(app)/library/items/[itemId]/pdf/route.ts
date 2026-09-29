import { TYPE_INFO } from '@lynx/content';
import { getLocale, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { reportError } from '@/server/errors';
import { selectVersions } from '@/server/library/view-model';
import {
  buildStudentPdfModel,
  buildTeacherPdfModel,
  libraryPdfRequest,
  type LibraryPdfModel,
} from '@/server/pdf/library-model';
import { renderLibraryPdf } from '@/server/pdf/render';
import {
  pdfFailedPage,
  pdfFileResponse,
  pdfNotFound,
  requestedPdfDisposition,
} from '@/server/pdf/response';
import { loadItemForStudentSheet, loadItemKeys, loadLibraryItem } from '@/server/queries/library';
import { requireSession, showLibrary } from '@/server/session';

// React-PDF and the fonts on disk need Node; every download is rendered for the caller.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * « Télécharger le PDF » of a library resource (`?doc=student|teacher&v=<versionIds>`, DECISIONS
 * D-075, D-053, D-062): the same documents as the print page, rendered on demand and never
 * stored, opened through a plain link so nothing is prefetched. Whoever can open the item page
 * can download it (row level security; 404 otherwise, and for anyone without library screens,
 * D-078).
 *
 * The student sheet is built from `loadItemForStudentSheet` alone, which never reads the answer
 * keys; « Guide et corrigé » adds each chosen version's key. A resource without a student sheet
 * (`lesson_plan`, `teacher_guide`) prints its guide, as the print page does.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/library/items/[itemId]/pdf'>,
) {
  const session = await requireSession();
  const { itemId } = await params;
  const wanted = libraryPdfRequest(new URL(request.url));
  if (!showLibrary(session) || !wanted || !z.uuid().safeParse(itemId).success) {
    return pdfNotFound();
  }

  const locale = await getLocale();
  const item = await loadLibraryItem(itemId, session, locale);
  if (!item) return pdfNotFound();
  const chosen = selectVersions(item.versions, wanted.versionIds);
  // Every item has a base version: none readable means nothing to print.
  if (!chosen.length) return pdfNotFound();
  const chosenIds = chosen.map((v) => v.id);
  const doc = TYPE_INFO[item.type].audience === 'teacher' ? 'teacher' : wanted.doc;

  let model: LibraryPdfModel;
  if (doc === 'student') {
    const source = await loadItemForStudentSheet(item.id, chosenIds);
    if (!source) return pdfNotFound();
    model = buildStudentPdfModel(source, item.versions.length);
  } else {
    model = buildTeacherPdfModel(item, chosen, await loadItemKeys(item.id, chosenIds));
  }

  const t = await getTranslations('libraryItem');
  const back = {
    href: `/library/items/${item.id}?v=${chosenIds[0]}&tab=${doc}`,
    label: t('print.back'),
  };
  // Content that cannot be read at all (another schema version): the item page says so too.
  if (!model.pages.length) return pdfFailedPage(t('pdf.unreadable'), back, locale, 422);

  try {
    const pdf = await renderLibraryPdf(model);
    return pdfFileResponse(pdf, model.fileName, requestedPdfDisposition(request));
  } catch (error) {
    // The renderer's own message (a font or layout failure), cut short: never the content.
    const message = error instanceof Error ? error.message : String(error);
    reportError('libraryPdf', { message: message.split('\n')[0]!.slice(0, 200) });
    return pdfFailedPage(t('pdf.failed'), back, locale);
  }
}
