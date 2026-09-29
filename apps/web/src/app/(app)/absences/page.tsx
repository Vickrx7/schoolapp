import { addDays, isLocalDate, localDateIn } from '@lynx/domain';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AbsenceList } from '@/components/absences/absence-list';
import { BoardRefresher } from '@/components/office/board-refresher';
import { SubDayBoard } from '@/components/office/sub-day-board';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { loadMyAbsences } from '@/server/queries/absences';
import { loadSubBoard } from '@/server/queries/sub-office';
import {
  requireSession,
  substituteBoardSchools,
  teachingSchools,
  type SessionContext,
} from '@/server/session';
import { subPortalConfigured } from '@/server/sub-portal/db';
import { subCodeKeys } from '@/server/sub-portal/keys';

export async function generateMetadata(): Promise<Metadata> {
  const session = await requireSession();
  const t = await getTranslations();
  return {
    title: substituteBoardSchools(session).length > 0 ? t('nav.substitutes') : t('absences.title'),
  };
}

/** How far back « Absences passées » goes. */
const PAST_DAYS = 60;

/** « Mes absences »: the teacher's upcoming and recent absences. */
async function MyAbsences({
  session,
  withHeading,
}: {
  session: SessionContext;
  withHeading: boolean;
}) {
  const t = await getTranslations('absences');
  const schools = teachingSchools(session);
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
  const Heading = withHeading ? 'h3' : 'h2';

  return (
    <div className="space-y-6">
      {withHeading ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">{t('title')}</h2>
          <Button asChild>
            <Link href="/absences/new">
              <Plus aria-hidden />
              {t('new')}
            </Link>
          </Button>
        </div>
      ) : null}
      <section aria-labelledby="absences-upcoming" className="space-y-3">
        <Heading id="absences-upcoming" className="text-lg font-semibold text-slate-900">
          {t('upcoming')}
        </Heading>
        {upcoming.length === 0 ? (
          <EmptyState title={t('empty')} body={t('emptyHelp')} />
        ) : (
          <AbsenceList absences={upcoming} timezones={timezones} />
        )}
      </section>
      {past.length > 0 ? (
        <section aria-labelledby="absences-past" className="space-y-3">
          <Heading id="absences-past" className="text-lg font-semibold text-slate-900">
            {t('past')}
          </Heading>
          <AbsenceList absences={past} timezones={timezones} />
        </section>
      ) : null}
    </div>
  );
}

/**
 * « Mes absences » for teachers; « Suppléances » for direction and office (DECISIONS D-056):
 * today and the next school day (or `?date=`), with each absent teacher's plan status, codes,
 * devices and report status. A principal who also teaches gets both.
 */
export default async function AbsencesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireSession();
  const teaching = teachingSchools(session).length > 0;
  const boardSchools = substituteBoardSchools(session);
  if (!teaching && boardSchools.length === 0) redirect('/today');
  const t = await getTranslations();

  if (boardSchools.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('absences.title')}
          actions={
            <Button asChild>
              <Link href="/absences/new">
                <Plus aria-hidden />
                {t('absences.new')}
              </Link>
            </Button>
          }
        />
        <MyAbsences session={session} withHeading={false} />
      </div>
    );
  }

  const { date: requested } = await searchParams;
  const today = localDateIn(boardSchools[0]!.timezone);
  const from = requested && isLocalDate(requested) ? requested : today;
  const configured = subPortalConfigured() && subCodeKeys() !== null;
  const boards = await Promise.all(
    boardSchools.map(async (school) => ({
      school,
      days: await loadSubBoard(school, from),
      today: localDateIn(school.timezone),
    })),
  );
  const now = new Date().toISOString();

  return (
    <div className="space-y-8">
      <BoardRefresher />
      <PageHeader
        title={t('office.title')}
        subtitle={t('office.subtitle')}
        actions={
          <form action="/absences" className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="block font-medium text-slate-700">{t('office.chooseDay')}</span>
              <Input type="date" name="date" defaultValue={from} className="w-auto" />
            </label>
            <Button type="submit" variant="secondary">
              {t('office.show')}
            </Button>
            {from !== today ? (
              <Button asChild variant="ghost">
                <Link href="/absences">{t('office.backToToday')}</Link>
              </Button>
            ) : null}
          </form>
        }
      />
      {boards.map(({ school, days, today: schoolToday }) => (
        <SubDayBoard
          key={school.id}
          school={{
            id: school.id,
            name: school.name,
            shortName: school.shortName,
            timezone: school.timezone,
            officePhone: school.settings.contact.officePhone?.trim() || null,
            arrivalInstructions: school.settings.substitute.arrivalInstructions,
          }}
          days={days}
          today={schoolToday}
          configured={configured}
          now={now}
          showSchoolName={boardSchools.length > 1}
        />
      ))}
      {teaching ? <MyAbsences session={session} withHeading /> : null}
    </div>
  );
}
