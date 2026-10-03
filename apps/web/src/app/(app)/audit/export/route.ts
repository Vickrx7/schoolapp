import { getLocale, getTranslations } from 'next-intl/server';
import type { NextRequest } from 'next/server';
import { auditCsv } from '@/server/audit/csv';
import { parseAuditFilters, scopeTimeZone } from '@/server/audit/filters';
import { asAuditT } from '@/server/audit/labels';
import { loadAuditExport, loadAuditScopes, logAuditExport } from '@/server/queries/audit';
import { requireSession } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * « Télécharger (CSV) » of « Journal d'audit » (DECISIONS D-103): the filters' entries (the page's
 * address, without its paging), newest first, at most 10,000, as the person may read them. The
 * export is recorded (`audit_log.exported`) once the file is built; when it cannot be recorded,
 * no file is sent.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const scopes = await loadAuditScopes(session);
  const filters = parseAuditFilters(request.nextUrl.searchParams, scopes, new Date());
  if (!filters) return new Response('Not found', { status: 404, headers: NO_STORE });
  const exported = { ...filters, before: null };
  const [rows, tAll, locale] = await Promise.all([
    loadAuditExport(exported, scopes),
    getTranslations(),
    getLocale(),
  ]);
  const t = asAuditT(tAll);
  const body = auditCsv(rows, { locale, timeZone: scopeTimeZone(exported.scope, scopes), t });
  await logAuditExport(exported, scopes, rows.length);
  return new Response(body, {
    headers: {
      ...NO_STORE,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${t('audit.csv.fileName')}-${exported.from}-${exported.to}.csv"`,
    },
  });
}
