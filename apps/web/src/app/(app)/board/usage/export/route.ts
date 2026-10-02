import { getLocale, getTranslations } from 'next-intl/server';
import type { NextRequest } from 'next/server';
import { monthOrCurrent } from '@/lib/month';
import { csvDocument } from '@/server/csv';
import { loadBoardBasics, loadBoardUsage, pickAdminBoard } from '@/server/queries/board';
import { requireSession } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * « Télécharger (CSV) » of « Utilisation de l'IA » (DECISIONS D-104): the month's totals per school
 * and the bulk line, as the page shows them. `;` and a decimal comma in French.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const params = request.nextUrl.searchParams;
  const board = pickAdminBoard(session, params.get('board'));
  const basics = board ? await loadBoardBasics(board.id) : null;
  if (!board || !basics) return new Response('Not found', { status: 404 });
  const month = monthOrCurrent(params.get('month'), basics.timezone);
  const rows = await loadBoardUsage(basics, month);
  const t = await getTranslations('board.usage');
  const locale = await getLocale();
  const body = csvDocument(
    [
      [t('csvMonth'), t('school'), t('requests'), t('failed'), t('cost')],
      ...rows.map((r) => [
        month,
        r.schoolId ? (r.schoolName ?? '') : t('bulk'),
        r.requests,
        r.failed,
        Math.round(r.costUsd * 10_000) / 10_000,
      ]),
    ],
    locale,
  );
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${t('fileName')}-${month}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
