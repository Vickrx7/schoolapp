import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AccessControls } from '@/components/board/access-controls';
import { BoardHeader } from '@/components/board/board-header';
import { RoleEditor } from '@/components/board/role-editor';
import { StaffStatusBadge } from '@/components/board/staff-status';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { serverEnv } from '@/server/env';
import { loadStaffPerson, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.staff');
  return { title: t('title') };
}

/**
 * « Fiche de la personne » (DECISIONS D-107): a person's roles in the board, their access, and
 * how to have the account deleted (by IP Lynx, on request). The URL names the person; every
 * change names them by one of their roles in the board.
 */
export default async function StaffPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ board?: string }>;
}) {
  const { userId } = await params;
  const { board: requested } = await searchParams;
  if (!z.uuid().safeParse(userId).success) notFound();
  const page = await requireBoardPage(requested);
  const person = await loadStaffPerson(page.basics, userId);
  if (!person) notFound();
  const t = await getTranslations('board.person');
  const tStaff = await getTranslations('board.staff');
  const tRoles = await getTranslations('profile.roleNames');
  const self = person.userId === page.session.userId;
  const support = serverEnv().SUPPORT_EMAIL;

  return (
    <div>
      <BoardHeader
        title={person.displayName}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path={`/board/staff/${person.userId}`}
        back={
          <Link
            href={`/board/staff${page.query}`}
            className="inline-flex min-h-11 items-center text-sm text-slate-600 hover:text-slate-900"
          >
            ← {t('back')}
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-2 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-all text-slate-700">{person.email}</p>
                <StaffStatusBadge status={person.status} />
              </div>
              {person.reviewer ? <p className="text-sm text-slate-600">{t('reviewer')}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('roles')}</CardTitle>
            </CardHeader>
            <CardBody>
              <RoleEditor
                name={person.displayName}
                roles={person.roles.map((r) => ({
                  id: r.id,
                  role: r.role,
                  label: tStaff('roleAt', {
                    role: tRoles(r.role),
                    place: r.schoolName ?? tStaff('wholeBoard'),
                  }),
                }))}
                schools={page.basics.schools.map((s) => ({ id: s.id, name: s.name }))}
                canAdd={!self}
              />
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('access')}</CardTitle>
            </CardHeader>
            <CardBody>
              <AccessControls
                roleId={person.roles[0]!.id}
                name={person.displayName}
                active={person.status !== 'removed'}
                self={self}
              />
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-2 pt-4 text-sm text-slate-600">
              <p>{t('deletion')}</p>
              {support ? (
                <a
                  href={`mailto:${support}?subject=${encodeURIComponent(t('deletionSubject'))}`}
                  className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-2"
                >
                  {t('deletionWrite')} ({support})
                </a>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
