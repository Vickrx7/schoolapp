import 'server-only';
import { composeSubPlan, type SubPlanEdits, type SubPlanV1 } from '@lynx/domain';
import { getLocale, getMessages } from 'next-intl/server';
import type { PlanContext, PlanLevel, RosterStudent } from '@/components/sub-plans/types';
import { defaultLocale, isLocale } from '@/i18n/config';
import { reportError } from '../errors';
import { buildActivitiesPdfModel } from './activities-model';
import { planPdfLabels } from './labels';
import { buildPlanPdfModel } from './model';
import { renderActivitiesPdf, renderPlanPdf } from './render';

/**
 * A plan's PDFs as HTTP responses (DECISIONS D-053), for the staff and portal routes: composed
 * for the 'pdf' audience (no « Gestion de classe »), with no alerts, never cached and never
 * stored. The plan is labelled in the reader's language; the students' activity sheets (3b) are
 * in French. The route has already checked who may print the plan and recorded the print when it
 * must be audited.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** A bare 404 that is never cached (no plan, or not one this caller may print). */
export function pdfNotFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** `?download=1`: the PDF is saved rather than opened (the substitute's phone keeps a copy). */
export function requestedPdfDisposition(request: Request): 'inline' | 'attachment' {
  return new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * A rendering failure as a small page with a way back, not a text file: the link that asked for
 * the PDF may save whatever comes back. `status` 422 when there is nothing to print (a library
 * resource whose content cannot be read) rather than a failure.
 */
export function pdfFailedPage(
  message: string,
  back: { href: string; label: string },
  lang: string,
  status = 500,
): Response {
  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(message)}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; color: #0f172a">
<p>${escapeHtml(message)}</p>
<p><a href="${escapeHtml(back.href)}" style="color: #1d4ed8">${escapeHtml(back.label)}</a></p>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** A rendered PDF, never cached: `inline` opens it, `attachment` saves it (`?download=1`). */
export function pdfFileResponse(
  pdf: Buffer,
  fileName: string,
  disposition: 'inline' | 'attachment' = 'inline',
): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${fileName}"`,
      'Content-Length': String(pdf.length),
    },
  });
}

/** What a plan's PDF route prints (`?doc=`): the plan, or the students' activity sheets. */
export type PlanPdfDoc = 'plan' | 'activities';

/** `?doc=` of a PDF route: the plan when it is absent; null for a document that does not exist. */
export function requestedPdfDoc(request: Request): PlanPdfDoc | null {
  const doc = new URL(request.url).searchParams.get('doc');
  if (doc === null || doc === 'plan') return 'plan';
  return doc === 'activities' ? 'activities' : null;
}

/**
 * The document asked for. Null only for the activity sheets of a plan with no activity (the AI's
 * instructions were never added, or were removed since): each route answers as it sees fit.
 */
export async function planPdfResponse(input: {
  doc: PlanPdfDoc;
  /** 'attachment' saves the file; 'inline' (default) opens it. */
  disposition?: 'inline' | 'attachment';
  /** Where the failure page leads back to (the plan's page). */
  backHref: string;
  plan: SubPlanV1;
  edits: SubPlanEdits | null;
  /** The AI layer (D-052), read leniently by composeSubPlan. */
  ai?: unknown;
  context: PlanContext;
  roster: RosterStudent[];
  levels: PlanLevel[];
}): Promise<Response | null> {
  const requested = await getLocale();
  const labels = planPdfLabels(
    isLocale(requested) ? requested : defaultLocale,
    await getMessages(),
  );
  const composed = composeSubPlan(input.plan, {
    edits: input.edits,
    ai: input.ai,
    audience: 'pdf',
  });

  let render: () => Promise<Buffer>;
  let fileName: string;
  if (input.doc === 'activities') {
    const model = buildActivitiesPdfModel(composed, input.roster, input.levels);
    if (model.sheets.length === 0) return null;
    render = () => renderActivitiesPdf(model);
    fileName = model.fileName;
  } else {
    const model = buildPlanPdfModel(composed, input.context, input.roster, input.levels, labels);
    render = () => renderPlanPdf(model);
    fileName = model.fileName;
  }

  try {
    return pdfFileResponse(await render(), fileName, input.disposition);
  } catch (error) {
    // The renderer's own message (a font or layout failure), cut short: never the plan's text.
    const message = error instanceof Error ? error.message : String(error);
    reportError(input.doc === 'activities' ? 'activitiesPdf' : 'planPdf', {
      message: message.split('\n')[0]!.slice(0, 200),
    });
    return pdfFailedPage(
      labels.failed,
      { href: input.backHref, label: labels.failedBack },
      labels.locale,
    );
  }
}
