import { getLocale, getMessages } from 'next-intl/server';
import { z } from 'zod';
import { defaultLocale, isLocale } from '@/i18n/config';
import { reportError } from '@/server/errors';
import { renderYearPlanPdf } from '@/server/pdf/render';
import {
  pdfFailedPage,
  pdfFileResponse,
  pdfNotFound,
  requestedPdfDisposition,
} from '@/server/pdf/response';
import { yearPlanPdfLabels } from '@/server/pdf/year-plan-labels';
import { buildYearPlanPdfModel } from '@/server/pdf/year-plan-model';
import { loadClass } from '@/server/queries/classes';
import { loadYearPlanPdf } from '@/server/queries/year-plan-pdf';
import { findSchool, hasModule, requireSession } from '@/server/session';

// React-PDF and the fonts on disk need Node; every download is rendered for the caller.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * « Plan à long terme (PDF) » of a class (`?coverage=1` adds « Couverture des attentes »,
 * `?download=1` saves the file; DECISIONS D-127, D-053): the year at a glance, then the units by
 * subject with their attentes, rendered on demand and never stored, opened through a plain link
 * so nothing is prefetched. For the class team only, as the class pages (a class the caller does
 * not teach, or a school without the Teaching module, is a 404). It reads no student data; it is
 * not audited: the teacher decides whom to give it to. The path ends in /pdf, so no page security
 * policy is added (a PDF viewer would not run under it).
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/classes/[classId]/planning/year/pdf'>,
) {
  const session = await requireSession();
  const { classId } = await params;
  if (!z.uuid().safeParse(classId).success) return pdfNotFound();
  const cls = await loadClass(session, classId);
  const school = cls ? findSchool(session, cls.schoolId) : null;
  if (!cls || !cls.myRole || !school || !hasModule(school, 'teaching')) return pdfNotFound();

  const requested = await getLocale();
  const labels = yearPlanPdfLabels(
    isLocale(requested) ? requested : defaultLocale,
    await getMessages(),
  );
  const back = { href: `/classes/${classId}/planning/year`, label: labels.failedBack };
  const coverage = new URL(request.url).searchParams.get('coverage') === '1';
  const input = await loadYearPlanPdf(session, cls, requested, { coverage });
  if (!input) return pdfFailedPage(labels.failed, back, labels.locale);

  try {
    const model = buildYearPlanPdfModel(input, labels);
    const pdf = await renderYearPlanPdf(model);
    return pdfFileResponse(pdf, model.fileName, requestedPdfDisposition(request));
  } catch (error) {
    // The renderer's own message (a font or layout failure), cut short: never the plan's text.
    const message = error instanceof Error ? error.message : String(error);
    reportError('yearPlanPdf', { message: message.split('\n')[0]!.slice(0, 200) });
    return pdfFailedPage(labels.failed, back, labels.locale);
  }
}
