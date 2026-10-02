import { localDateIn } from '@lynx/domain';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditFilterPanel, type ScopeOption } from '@/components/audit/audit-filters';
import { AuditList, type AuditListEntry } from '@/components/audit/audit-list';
import { ExportLink, ExportNote } from '@/components/audit/export-link';
import { BoardHeader } from '@/components/board/board-header';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { Notice } from '@/components/ui/card';
import {
  AUDIT_PAGE_SIZE,
  auditCategoriesFor,
  auditFilterCount,
  auditHref,
  parseAuditFilters,
  scopeTimeZone,
  type AuditFilters,
  type AuditScopes,
} from '@/server/audit/filters';
import { asAuditT, auditEntryView } from '@/server/audit/labels';
import { loadAuditPage, loadAuditPeople, loadAuditScopes } from '@/server/queries/audit';
import { requireBoardPage } from '@/server/queries/board';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audit');
  return { title: t('title') };
}

/** Every scope the person may read, for « Portée ». */
async function scopeOptions(scopes: AuditScopes): Promise<ScopeOption[]> {
  const t = await getTranslations('audit.filters');
  return [
    ...scopes.schools.map((s) => ({
      scope: { kind: 'school' as const, schoolId: s.id },
      label: t('schoolScope', { name: s.name }),
    })),
    ...scopes.boards.map((b) => ({
      scope: { kind: 'board' as const, boardId: b.id, schoolId: null },
      label: t('boardScope', { name: b.name }),
    })),
  ];
}

/** The scope's address with no other filter. */
const scopeOnly = (filters: AuditFilters) =>
  filters.scope.kind === 'school'
    ? `/audit?school=${filters.scope.schoolId}`
    : `/audit?board=${filters.scope.boardId}`;

/**
 * « Journal d'audit » (DECISIONS D-103): for the direction, their school's entries (alerts,
 * substitute days, class teams, accounts and switches); for a board's admins, the board's
 * (accounts, settings, library approvals, IP Lynx's access), as one of « Conseil »'s sections.
 * What each person reads is decided by `list_audit_entries`. Anyone else: « Page introuvable ».
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const scopes = await loadAuditScopes(session);
  const filters = parseAuditFilters(params, scopes, new Date());
  if (!filters) notFound();
  const board =
    filters.scope.kind === 'board' ? await requireBoardPage(filters.scope.boardId) : null;

  const timeZone = scopeTimeZone(filters.scope, scopes);
  const [{ rows, hasMore }, people, tAll, t, locale, options] = await Promise.all([
    loadAuditPage(filters, scopes, AUDIT_PAGE_SIZE),
    loadAuditPeople(filters.scope),
    getTranslations(),
    getTranslations('audit'),
    getLocale(),
    scopeOptions(scopes),
  ]);
  const tAudit = asAuditT(tAll);
  const entries: AuditListEntry[] = rows.map((row) => ({
    ...auditEntryView(row, { t: tAudit, locale, timeZone }),
    historyHref:
      row.entity_id && row.entity_id !== filters.entity
        ? auditHref(filters, { entity: row.entity_id })
        : null,
  }));
  const scope = filters.scope;
  const school =
    scope.kind === 'school' ? scopes.schools.find((s) => s.id === scope.schoolId) : null;
  const boardSchools =
    scope.kind === 'board'
      ? (scopes.boards.find((b) => b.id === scope.boardId)?.schools ?? [])
      : [];
  const exportHref = auditHref(filters, {}, '/audit/export');

  return (
    <div>
      {board ? (
        <BoardHeader
          title={t('title')}
          board={board.board}
          boards={board.boards}
          query={board.query}
          library={board.library}
          path="/audit"
          actions={<ExportLink href={exportHref} />}
        />
      ) : (
        <PageHeader
          title={t('title')}
          subtitle={school?.name}
          actions={<ExportLink href={exportHref} />}
        />
      )}
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{board ? t('boardIntro') : t('intro')}</p>
        <AuditFilterPanel
          filters={filters}
          scopes={options}
          boardSchools={boardSchools}
          people={people}
          categories={auditCategoriesFor(filters.scope, scopes)}
          clearHref={scopeOnly(filters)}
          count={auditFilterCount(filters, localDateIn(timeZone))}
        />
        {filters.entity ? (
          <Notice className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('filters.entity')}</span>
            <Link
              href={auditHref(filters, { entity: null })}
              className="inline-flex min-h-11 items-center font-medium underline"
            >
              {t('filters.clearEntity')}
            </Link>
          </Notice>
        ) : null}
        {entries.length === 0 ? (
          <EmptyState title={t('empty')} body={t('emptyHelp')} />
        ) : (
          <AuditList
            entries={entries}
            showSchool={filters.scope.kind === 'board' && !filters.scope.schoolId}
          />
        )}
        {hasMore || filters.before ? (
          <nav className="flex flex-wrap gap-2" aria-label={t('pages')}>
            {filters.before ? (
              <Button asChild variant="ghost">
                <Link href={auditHref(filters)}>{t('newest')}</Link>
              </Button>
            ) : null}
            {hasMore ? (
              <Button asChild variant="secondary">
                <Link href={auditHref(filters, { before: rows.at(-1)!.id })}>{t('older')}</Link>
              </Button>
            ) : null}
          </nav>
        ) : null}
        <ExportNote />
      </div>
    </div>
  );
}
