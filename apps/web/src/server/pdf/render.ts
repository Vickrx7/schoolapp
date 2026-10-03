/**
 * Renders the plan PDF, the students' activity sheets, the library's PDFs, the long-range plan and
 * « Info-parents » in memory (DECISIONS D-053, D-075, D-127, D-141): nothing is stored, every
 * download is built from the plan, the resource, the year or the saved message as it is now. The
 * fonts are warmed before the first render of the process (`warmPdfFonts`: without it, an
 * accented capital in one PDF could drop the plain letter from later ones). Not server-only, so it
 * can be unit tested; only route handlers import it.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import { ActivitiesDocument } from './activities-document';
import { hasPages, type ActivitiesPdfModel } from './activities-model';
import { registerPdfFonts, warmPdfFonts } from './fonts';
import { LibraryDocument } from './library-document';
import type { LibraryPdfModel } from './library-model';
import type { PlanPdfModel } from './model';
import {
  NEWSLETTER_BODY_SIZES,
  NEWSLETTER_PAGE_ROOM,
  NewsletterDocument,
  newsletterPageHeight,
} from './newsletter-document';
import type { NewsletterPdfModel } from './newsletter-model';
import { PlanDocument } from './plan-document';
import { YearPlanDocument } from './year-plan-document';
import type { YearPlanPdfModel } from './year-plan-model';

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

/** « Plan à long terme » (D-127): the year at a glance, the units by subject, coverage if asked. */
export async function renderYearPlanPdf(model: YearPlanPdfModel): Promise<Buffer> {
  registerPdfFonts();
  await warmPdfFonts();
  return renderToBuffer(YearPlanDocument({ model }));
}

/** How many pages a rendered PDF has (its page objects; the page tree is `/Pages`). */
export function pdfPageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

/**
 * « Info-parents » (D-141): one page per language when the message fits. The body size is the
 * largest of `NEWSLETTER_BODY_SIZES` whose estimated height fits a page (with a little room, as
 * the estimate errs long), checked on the rendered file and stepped down while a language runs
 * over; a message too long for one page at the smallest size is set at the largest, over more
 * pages, since it turns the page anyway.
 */
export async function renderNewsletterPdf(model: NewsletterPdfModel): Promise<Buffer> {
  registerPdfFonts();
  await warmPdfFonts();
  const render = (size: number) => renderToBuffer(NewsletterDocument({ model, size }));
  const fits = (size: number) =>
    model.pages.every((page) => newsletterPageHeight(page, size) <= NEWSLETTER_PAGE_ROOM * 1.08);
  const largest = NEWSLETTER_BODY_SIZES[0];
  const start = NEWSLETTER_BODY_SIZES.findIndex(fits);
  if (start < 0) return render(largest);
  for (const size of NEWSLETTER_BODY_SIZES.slice(start)) {
    const pdf = await render(size);
    if (pdfPageCount(pdf) <= model.pages.length) return pdf;
  }
  return render(largest);
}
