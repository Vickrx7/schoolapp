/**
 * Renders the plan PDF in memory (DECISIONS D-053): nothing is stored, every download is built
 * from the plan as it is now. Not server-only, so it can be unit tested; only route handlers
 * import it.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import { registerPdfFonts } from './fonts';
import type { PlanPdfModel } from './model';
import { PlanDocument } from './plan-document';

export async function renderPlanPdf(model: PlanPdfModel): Promise<Buffer> {
  registerPdfFonts();
  // Called as a function: renderToBuffer wants the <Document> element itself.
  return renderToBuffer(PlanDocument({ model }));
}
