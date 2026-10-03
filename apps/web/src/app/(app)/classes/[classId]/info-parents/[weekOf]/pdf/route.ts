import { getLocale, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { reportError } from '@/server/errors';
import { newsletterCatalogs } from '@/server/newsletter/catalogs';
import { isWeekOf } from '@/server/newsletter/view-model';
import {
  buildNewsletterPdfModel,
  newsletterPdfLabels,
  newsletterPdfLanguage,
} from '@/server/pdf/newsletter-model';
import { renderNewsletterPdf } from '@/server/pdf/render';
import {
  pdfFailedPage,
  pdfFileResponse,
  pdfNotFound,
  requestedPdfDisposition,
} from '@/server/pdf/response';
import { loadClass } from '@/server/queries/classes';
import { loadNewsletter } from '@/server/queries/newsletters';
import { findSchool, hasModule, hasRole, requireSession } from '@/server/session';

// React-PDF and the fonts on disk need Node; every download is rendered for the caller.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * « Imprimer (PDF) » of a week's « Info-parents » message (`?lang=both|fr|en`, both by default;
 * `?download=1` saves the file; DECISIONS D-141, D-053): the saved message as the families read it,
 * one language per page, rendered on demand from the stored row and never stored. For the class
 * team with a teacher role, as the week's page (anyone else, a week that is not a Monday, a week
 * without a message or an unknown language is a 404). It reads no roster; the editor has already
 * shown « Des élèves sont nommés ». Not audited: the teacher decides whom to give it to, as she
 * does with the copied text (D-103). The path ends in /pdf, so no page security policy is added
 * (a PDF viewer would not run under it).
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/classes/[classId]/info-parents/[weekOf]/pdf'>,
) {
  const session = await requireSession();
  const { classId, weekOf } = await params;
  const lang = newsletterPdfLanguage(new URL(request.url).searchParams.get('lang'));
  if (!z.uuid().safeParse(classId).success || !isWeekOf(weekOf) || !lang) return pdfNotFound();
  const cls = await loadClass(session, classId);
  const school = cls ? findSchool(session, cls.schoolId) : null;
  if (
    !cls ||
    !cls.myRole ||
    !school ||
    !hasModule(school, 'teaching') ||
    !hasRole(school, 'teacher')
  ) {
    return pdfNotFound();
  }
  const newsletter = await loadNewsletter(session, cls, weekOf, { names: false });
  if (!newsletter) return pdfNotFound();

  const [t, locale] = await Promise.all([getTranslations('newsletter'), getLocale()]);
  const back = { href: `/classes/${classId}/info-parents/${weekOf}`, label: t('pdf.failedBack') };
  // Content the app cannot read (the page says so too): nothing to print.
  if (!newsletter.content) return pdfFailedPage(t('editor.unreadable'), back, locale, 422);

  try {
    const catalogs = await newsletterCatalogs();
    const model = buildNewsletterPdfModel(
      {
        content: newsletter.content,
        school: school.name,
        className: cls.name,
        weekOf,
        lang,
      },
      {
        fr: newsletterPdfLabels('fr-CA', catalogs.fr),
        en: newsletterPdfLabels('en-CA', catalogs.en),
      },
    );
    const pdf = await renderNewsletterPdf(model);
    return pdfFileResponse(pdf, model.fileName, requestedPdfDisposition(request));
  } catch (error) {
    // The renderer's own message (a font or layout failure), cut short: never the message's text.
    const message = error instanceof Error ? error.message : String(error);
    reportError('newsletterPdf', { message: message.split('\n')[0]!.slice(0, 200) });
    return pdfFailedPage(t('pdf.failed'), back, locale);
  }
}
