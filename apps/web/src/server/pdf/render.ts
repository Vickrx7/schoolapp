/**
 * Renders the plan PDF and the students' activity sheets in memory (DECISIONS D-053): nothing is
 * stored, every download is built from the plan as it is now. Not server-only, so it can be unit
 * tested; only route handlers import it.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import { ActivitiesDocument } from './activities-document';
import type { ActivitiesPdfModel } from './activities-model';
import { registerPdfFonts } from './fonts';
import type { PlanPdfModel } from './model';
import { PlanDocument } from './plan-document';

export async function renderPlanPdf(model: PlanPdfModel): Promise<Buffer> {
  registerPdfFonts();
  // Called as a function: renderToBuffer wants the <Document> element itself.
  return renderToBuffer(PlanDocument({ model }));
}

/** At least one sheet: a document without pages is not a PDF (the routes answer 404 instead). */
export async function renderActivitiesPdf(model: ActivitiesPdfModel): Promise<Buffer> {
  if (model.sheets.length === 0) throw new Error('No activity sheet to render');
  registerPdfFonts();
  return renderToBuffer(ActivitiesDocument({ model }));
}
