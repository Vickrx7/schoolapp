import { ChevronRight, Search } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClassLinkCard } from '@/components/class-mode/class-link-card';
import { CurrentSessionCard } from '@/components/class-mode/current-session-card';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { classPortalConfigured } from '@/server/class-portal/db';
import { classLinkUrl, qrSvg } from '@/server/class-mode/links';
import { serverEnv } from '@/server/env';
import { libraryHref } from '@/server/library/search-params';
import { loadClassLinkToken, loadClassModeTab } from '@/server/queries/class-mode';
import { loadClass } from '@/server/queries/classes';
import { findSchool, hasModule, requireSession } from '@/server/session';

type Props = { params: Promise<{ classId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classMode');
  return { title: t('tab') };
}

/**
 * The class tab « Mode classe » (DECISIONS D-084, D-089, D-090): « Séance en cours » (resume or
 * end it, from any device), « Lien de la classe » (bookmark it once on each class device) and
 * « Résultats gardés ». For the class team with a teacher role at a school with the Library
 * module (the class layout needs the Teaching module, as every class page); quizzes start from a
 * resource's page.
 */
export default async function ClassModePage({ params }: Props) {
  const session = await requireSession();
  const { classId } = await params;
  const cls = await loadClass(session, classId);
  const school = cls ? findSchool(session, cls.schoolId) : null;
  if (!cls || !school) notFound();
  const t = await getTranslations('classMode');
  if (!hasModule(school, 'library')) return <Notice>{t('noLibrary')}</Notice>;

  const tab = await loadClassModeTab(classId);
  if (!tab) notFound();
  const configured = classPortalConfigured();
  const token = configured ? await loadClassLinkToken(classId) : null;
  const link = token ? classLinkUrl(serverEnv().APP_BASE_URL, token) : null;
  const qr = link ? await qrSvg(link) : null;
  const format = await getFormatter();
  const findQuiz = libraryHref({
    types: ['quiz', 'game'],
    grade: cls.gradeCodes.length === 1 ? cls.gradeCodes[0]! : null,
  });

  return (
    <div className="space-y-5">
      <p className="text-slate-700">{t('intro')}</p>
      {!configured ? <Notice tone="warning">{t('notConfigured')}</Notice> : null}

      {tab.open ? (
        <CurrentSessionCard open={tab.open} keep={tab.openKeep} retentionDays={tab.retentionDays} />
      ) : (
        <Card>
          <CardBody className="space-y-3 pt-4">
            <p className="text-slate-700">{t('howToStart')}</p>
            <Button asChild variant="secondary">
              <Link href={findQuiz}>
                <Search aria-hidden />
                {t('findQuiz')}
              </Link>
            </Button>
          </CardBody>
        </Card>
      )}

      {link && qr ? <ClassLinkCard classId={classId} url={link} qrSvg={qr} /> : null}
      {configured && !link ? <Notice tone="warning">{t('link.unavailable')}</Notice> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('results.title')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {tab.results.length === 0 ? (
            <p className="text-sm text-slate-600">{t('results.empty')}</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {tab.results.map((result) => (
                <li key={result.sessionId}>
                  <Link
                    href={`/classes/${classId}/class-mode/results/${result.sessionId}`}
                    className="flex min-h-14 items-center gap-3 py-2 hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900">
                        {result.itemTitle ?? t('results.untitled')}
                      </span>
                      <span className="block text-sm text-slate-600">
                        {format.dateTime(new Date(result.savedAt), {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                        {' · '}
                        {t('results.summary', {
                          devices: result.participantCount,
                          played: result.questionsPlayed,
                        })}
                      </span>
                    </span>
                    <span className="sr-only">{t('results.open')}</span>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-slate-600">
            {t('results.retention', { days: tab.retentionDays })}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
