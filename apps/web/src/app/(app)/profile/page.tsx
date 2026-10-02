import { ListChecks } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SignOutForm } from '@/components/app/sign-out-form';
import { LanguageForm } from '@/components/school/language-form';
import { ProfileForm } from '@/components/school/profile-form';
import { Badge, Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { requireSession, teachingSchools } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return { title: t('title') };
}

export default async function ProfilePage() {
  const session = await requireSession();
  const t = await getTranslations('profile');
  const tOnboarding = await getTranslations('onboarding');
  const schoolName = (id: string | null) => session.schools.find((s) => s.id === id)?.name;
  const boardName = (id: string) => session.boards.find((b) => b.id === id)?.name;

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title={t('title')} />
      <Card>
        <CardBody className="space-y-4 pt-4">
          <ProfileForm displayName={session.displayName} honorific={session.honorific ?? ''} />
          <LanguageForm />
          <div>
            <p className="text-sm font-medium text-slate-700">{t('email')}</p>
            <p className="text-slate-900">{session.email}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">{t('roles')}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {session.roles.map((r) => (
                <li key={`${r.role}:${r.schoolId ?? r.boardId}`}>
                  <Badge tone="brand">
                    {t(`roleNames.${r.role}`)} ·{' '}
                    {r.schoolId ? schoolName(r.schoolId) : boardName(r.boardId)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>
      {teachingSchools(session).length > 0 ? (
        // « Pour bien commencer » stays reachable once hidden on « Aujourd'hui » (D-109).
        <Card>
          <CardBody className="pt-4">
            <h2 className="text-sm font-medium text-slate-700">{tOnboarding('title')}</h2>
            <Link
              href="/demarrage"
              className="inline-flex min-h-11 items-center gap-2 font-medium text-brand-700 underline underline-offset-2"
            >
              <ListChecks className="size-4 shrink-0" aria-hidden />
              {tOnboarding('open')}
            </Link>
          </CardBody>
        </Card>
      ) : null}
      <SignOutForm />
    </div>
  );
}
