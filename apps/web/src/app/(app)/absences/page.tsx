import { addDays, localDateIn } from '@lynx/domain';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AbsenceList } from '@/components/absences/absence-list';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { loadMyAbsences } from '@/server/queries/absences';
import { requireSession, teachingSchools } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('absences');
  return { title: t('title') };
}

/** How far back « Absences passées » goes. */
const PAST_DAYS = 60;

/**
 * « Mes absences »: the teacher's upcoming and recent absences. (The office and direction
 * board of the day's substitutes comes with the substitute portal.)
 */
export default async function AbsencesPage() {
  const session = await requireSession();
  const schools = teachingSchools(session);
  if (schools.length === 0) redirect('/today');
  const t = await getTranslations('absences');
  const today = localDateIn(schools[0]!.timezone);
  const [upcoming, past] = await Promise.all([
    loadMyAbsences(session, { from: today, limit: 30 }),
    loadMyAbsences(session, {
      from: addDays(today, -PAST_DAYS),
      to: today,
      limit: 10,
      ascending: false,
    }),
  ]);
  const timezones = Object.fromEntries(session.schools.map((s) => [s.id, s.timezone]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        actions={
          <Button asChild>
            <Link href="/absences/new">
              <Plus aria-hidden />
              {t('new')}
            </Link>
          </Button>
        }
      />
      <section aria-labelledby="absences-upcoming" className="space-y-3">
        <h2 id="absences-upcoming" className="text-lg font-semibold text-slate-900">
          {t('upcoming')}
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState title={t('empty')} body={t('emptyHelp')} />
        ) : (
          <AbsenceList absences={upcoming} timezones={timezones} />
        )}
      </section>
      {past.length > 0 ? (
        <section aria-labelledby="absences-past" className="space-y-3">
          <h2 id="absences-past" className="text-lg font-semibold text-slate-900">
            {t('past')}
          </h2>
          <AbsenceList absences={past} timezones={timezones} />
        </section>
      ) : null}
    </div>
  );
}
