import 'server-only';
import { composeSubPlan, type SubPlanEdits, type SubPlanV1 } from '@lynx/domain';
import { getLocale, getMessages } from 'next-intl/server';
import type { PlanContext, PlanLevel, RosterStudent } from '@/components/sub-plans/types';
import { defaultLocale, isLocale } from '@/i18n/config';
import { reportError } from '../errors';
import { planPdfLabels } from './labels';
import { buildPlanPdfModel } from './model';
import { renderPlanPdf } from './render';

/**
 * The plan PDF as an HTTP response (DECISIONS D-053), for the staff and portal routes: composed
 * for the 'pdf' audience (no « Gestion de classe »), with no alerts, labelled in the reader's
 * language, never cached and never stored. The route has already checked who may print it and
 * recorded the print when it must be audited.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** A bare 404 that is never cached (no plan, or not one this caller may print). */
export function pdfNotFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function planPdfResponse(input: {
  plan: SubPlanV1;
  edits: SubPlanEdits | null;
  context: PlanContext;
  roster: RosterStudent[];
  levels: PlanLevel[];
}): Promise<Response> {
  const requested = await getLocale();
  const labels = planPdfLabels(
    isLocale(requested) ? requested : defaultLocale,
    await getMessages(),
  );
  const model = buildPlanPdfModel(
    composeSubPlan(input.plan, { edits: input.edits, audience: 'pdf' }),
    input.context,
    input.roster,
    input.levels,
    labels,
  );
  try {
    const pdf = await renderPlanPdf(model);
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${model.fileName}"`,
        'Content-Length': String(pdf.length),
      },
    });
  } catch (error) {
    // The renderer's own message (a font or layout failure), cut short: never the plan's text.
    const message = error instanceof Error ? error.message : String(error);
    reportError('planPdf', { message: message.split('\n')[0]!.slice(0, 200) });
    return new Response(labels.failed, {
      status: 500,
      headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
