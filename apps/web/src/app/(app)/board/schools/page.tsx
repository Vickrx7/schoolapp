import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BoardHeader } from '@/components/board/board-header';
import { Badge } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/page';
import { hasContact, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.schools');
  return { title: t('title') };
}

/** « Écoles » (DECISIONS D-108): the board's schools. IP Lynx adds schools (the CLI). */
export default async function BoardSchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: requested } = await searchParams;
  const page = await requireBoardPage(requested);
  const t = await getTranslations('board.schools');

  return (
    <div>
      <BoardHeader
        title={t('title')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path="/board/schools"
      />
      <p className="mb-4 text-sm text-slate-600">{t('intro')}</p>
      {page.basics.schools.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-2">
          {page.basics.schools.map((s) => (
            <li key={s.id}>
              <Link
                href={`/board/schools/${s.id}${page.query}`}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{s.name}</span>
                  {s.settings.contact.officePhone ? (
                    <span className="block text-sm text-slate-600">
                      {s.settings.contact.officePhone}
                    </span>
                  ) : null}
                </span>
                {!hasContact(s) ? <Badge tone="warning">{t('contactMissing')}</Badge> : null}
                <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
