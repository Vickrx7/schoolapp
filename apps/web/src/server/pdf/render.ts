/**
 * Renders the plan PDF, the students' activity sheets and the library's PDFs in memory (DECISIONS
 * D-053, D-075): nothing is stored, every download is built from the plan or the resource as it
 * is now. The fonts are warmed before the first render of the process (`warmPdfFonts`: without
 * it, an accented capital in one PDF could drop the plain letter from later ones). Not
 * server-only, so it can be unit tested; only route handlers import it.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import { ActivitiesDocument } from './activities-document';
import { hasPages, type ActivitiesPdfModel } from './activities-model';
import { registerPdfFonts, warmPdfFonts } from './fonts';
import { LibraryDocument } from './library-document';
import type { LibraryPdfModel } from './library-model';
import type { PlanPdfModel } from './model';
import { PlanDocument } from './plan-document';

export async function renderPlanPdf(model: PlanPdfModel): Promise<Buffer> {
  registerPdfFonts();
  await warmPdfFonts();
  // Called as a function: renderToBuffer wants the <Document> element itself.
  return renderToBuffer(PlanDocument({ model }));
}

/** At least one sheet: a document without pages is not a PDF (the routes answer 404 instead). */
export async function renderActivitiesPdf(model: ActivitiesPdfModel): Promise<Buffer> {
  if (!hasPages(model)) throw new Error('No activity sheet to render');
  registerPdfFonts();
  await warmPdfFonts();
  return renderToBuffer(ActivitiesDocument({ model }));
}

/** At least one page, like the activity sheets: the library route answers with a page instead. */
export async function renderLibraryPdf(model: LibraryPdfModel): Promise<Buffer> {
  if (model.pages.length === 0) throw new Error('No library page to render');
  registerPdfFonts();
  await warmPdfFonts();
  return renderToBuffer(LibraryDocument({ model }));
}
