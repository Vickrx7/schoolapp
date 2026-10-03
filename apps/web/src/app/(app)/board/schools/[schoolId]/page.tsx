import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BoardHeader } from '@/components/board/board-header';
import { SchoolContactCard } from '@/components/board/school-contact-card';
import { SchoolReadonlyCard } from '@/components/board/school-readonly-card';
import { AiSchoolCard, type AiUsage } from '@/components/school/ai-school-card';
import { requireBoardPage } from '@/server/queries/board';
import { createSupabaseServerClient } from '@/server/supabase';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.schools');
  return { title: t('title') };
}

/**
 * A school of the board (DECISIONS D-108): its contact details and bell times, its AI switch
 * (normally the direction's; an Assumption for schools without a direction account), and what the
 * board does not change here (schedule, modules, the alerts switch).
 */
export default async function BoardSchoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<{ board?: string }>;
}) {
  const { schoolId } = await params;
  const { board: requested } = await searchParams;
  const page = await requireBoardPage(requested);
  const school = page.basics.schools.find((s) => s.id === schoolId);
  if (!school) notFound();
  const t = await getTranslations('board.schools');
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc('ai_usage_summary', { p_school_id: school.id });
  const row = data?.[0];
  const usage: AiUsage | null = row
    ? {
        spent: Number(row.school_spent_usd),
        allowance: Number(row.allowance_usd),
        poolSpent: Number(row.pool_spent_usd),
        poolTotal: Number(row.pool_usd),
        pooling: row.pooling,
        available: row.available,
        requests: Number(row.requests_this_month),
      }
    : null;

  return (
    <div>
      <BoardHeader
        title={school.name}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path={`/board/schools/${school.id}`}
        back={
          <Link
            href={`/board/schools${page.query}`}
            className="inline-flex min-h-11 items-center text-sm text-slate-600 hover:text-slate-900"
          >
            ← {t('back')}
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SchoolContactCard
          school={{ id: school.id, name: school.name }}
          contact={{
            officePhone: school.settings.contact.officePhone ?? '',
            officeEmail: school.settings.contact.officeEmail ?? '',
            dayStart: school.settings.dayStart,
            dayEnd: school.settings.dayEnd,
          }}
          canEdit
        />
        <div className="space-y-4">
          <div className="space-y-2">
            <AiSchoolCard
              school={{
                id: school.id,
                name: school.name,
                aiEnabled: school.aiEnabled,
                boardAllows: page.board.settings.ai.allowed,
              }}
              canEdit
              usage={usage}
            />
            <p className="text-sm text-slate-600">{t('aiNote')}</p>
          </div>
          <SchoolReadonlyCard
            scheduleType={school.scheduleType}
            cycleLength={school.cycleLength}
            modules={school.modules}
            studentAlertsEnabled={school.studentAlertsEnabled}
          />
        </div>
      </div>
    </div>
  );
}
