import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LanguageForm } from '@/components/school/language-form';
import { ProfileForm } from '@/components/school/profile-form';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { signOut } from '@/server/actions/auth';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return { title: t('title') };
}

export default async function ProfilePage() {
  const session = await requireSession();
  const t = await getTranslations('profile');
  const tNav = await getTranslations('nav');
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
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          {tNav('signOut')}
        </Button>
      </form>
    </div>
  );
}
