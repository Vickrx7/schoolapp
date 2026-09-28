import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewClassButton } from '@/components/classes/new-class-button';
import { Badge, Card } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { listMyClasses, loadClassFormOptions } from '@/server/queries/classes';
import { requireSession, teachingSchools } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classes');
  return { title: t('title') };
}

export default async function ClassesPage() {
  const session = await requireSession();
  if (teachingSchools(session).length === 0) redirect('/calendar');
  const t = await getTranslations('classes');
  const locale = await getLocale();
  const [classes, options] = await Promise.all([
    listMyClasses(session, locale),
    loadClassFormOptions(session, locale),
  ]);

  return (
    <div>
      <PageHeader title={t('title')} actions={<NewClassButton options={options} />} />
      {classes.length === 0 ? (
        <EmptyState
          title={t('empty')}
          body={t('emptyHelp')}
          action={<NewClassButton options={options} />}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {classes.map((c) => (
            <li key={c.id}>
              <Link href={`/classes/${c.id}/students`} className="block">
                <Card className="p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">{c.name}</h2>
                    <Badge tone={c.role === 'homeroom' ? 'brand' : 'neutral'}>
                      {t(`role.${c.role}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {c.gradeLabels.join(' / ')} · {t('studentCount', { count: c.studentCount })}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
