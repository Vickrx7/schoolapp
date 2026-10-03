import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AbsencesTodayCard } from '@/components/direction/absences-today-card';
import { AiUsageCard } from '@/components/direction/ai-usage-card';
import { AlertAccessCard } from '@/components/direction/alert-access-card';
import { ContributionsCard } from '@/components/direction/contributions-card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page';
import { asAuditT, auditEntryView } from '@/server/audit/labels';
import { loadDirectionDashboard } from '@/server/queries/direction';
import { aiOn, directionSchools, landingFor, requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('direction');
  return { title: t('title') };
}

/**
 * « Tableau de bord de la direction » (DECISIONS D-102): the landing page of a principal or
 * vice-principal who does not teach (D-118). Per school: today's absences and their plans, the
 * library contributions of the school year, the month's AI totals and the latest alert entries
 * of the audit log. Read only; never a teacher's planning.
 */
export default async function DirectionPage() {
  const session = await requireSession();
  if (directionSchools(session).length === 0) redirect(landingFor(session));
  const [t, tAll, locale, schools] = await Promise.all([
    getTranslations('direction'),
    getTranslations(),
    getLocale(),
    loadDirectionDashboard(session),
  ]);
  const tAudit = asAuditT(tAll);
  const firstSchool = schools[0]?.school.id;

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <Button asChild variant="secondary">
            <Link href={firstSchool ? `/audit?school=${firstSchool}` : '/audit'}>
              <ScrollText aria-hidden />
              {t('auditLink')}
            </Link>
          </Button>
        }
      />
      <div className="space-y-8">
        {schools.map(({ school, today, days, contributions, ai, alerts }) => (
          <section key={school.id} aria-labelledby={`direction-${school.id}`} className="space-y-4">
            <h2 id={`direction-${school.id}`} className="text-lg font-semibold text-slate-900">
              {school.name}
            </h2>
            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              {days ? (
                <AbsencesTodayCard days={days} today={today} timeZone={school.timezone} />
              ) : null}
              <AlertAccessCard
                entries={alerts.map((entry) =>
                  auditEntryView(entry, { t: tAudit, locale, timeZone: school.timezone }),
                )}
                auditHref={`/audit?school=${school.id}&category=alerts`}
              />
              {contributions ? <ContributionsCard contributions={contributions} /> : null}
              <AiUsageCard usage={ai} aiOn={aiOn(session, school)} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
