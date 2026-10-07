import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { BoardHeader } from '@/components/board/board-header';
import { CancelInvitationButton } from '@/components/board/cancel-invitation-button';
import { InvitationStatus } from '@/components/board/invitation-status';
import { InviteMessageCard } from '@/components/board/invite-message';
import { StaffStatusBadge } from '@/components/board/staff-status';
import { Card, CardBody, Notice } from '@/components/ui/card';
import { isLocale } from '@/i18n/config';
import { APP_NAME } from '@/lib/app-name';
import { serverEnv } from '@/server/env';
import { inviteMessages } from '@/server/invite-message';
import { loadInvitation, requireBoardPage } from '@/server/queries/board';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board.invite');
  return { title: t('pageTitle') };
}

const FAILURES = ['emailConflict', 'authNotConfigured', 'authRefused', 'expired'] as const;

/**
 * « Invitation » (DECISIONS D-107): « Préparation du compte… » while the worker works, then the
 * message to send (French or English, `?lang=`), or why it did not go through.
 */
export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ invitationId: string }>;
  searchParams: Promise<{ board?: string; lang?: string }>;
}) {
  const { invitationId } = await params;
  const { lang } = await searchParams;
  if (!z.uuid().safeParse(invitationId).success) notFound();
  const invitation = await loadInvitation(invitationId);
  if (!invitation) notFound();
  const page = await requireBoardPage(invitation.boardId);
  if (page.board.id !== invitation.boardId) notFound();
  const t = await getTranslations('board.invite');
  const tStaff = await getTranslations('board.staff');
  const tRoles = await getTranslations('profile.roleNames');
  const tErrors = await getTranslations('errors');
  const locale = await getLocale();
  const place = invitation.schoolName ?? page.board.name;

  const messages =
    invitation.status === 'ready' && !invitation.immediate
      ? await inviteMessages({
          name: invitation.displayName,
          email: invitation.email,
          loginUrl: `${serverEnv().APP_BASE_URL.replace(/\/+$/, '')}/login`,
          inviterName: page.session.displayName,
          appName: APP_NAME,
          role: invitation.role,
          place,
        })
      : null;
  const failure = FAILURES.find((f) => f === invitation.errorCode);

  return (
    <div>
      <BoardHeader
        title={t('pageTitle')}
        board={page.board}
        boards={page.boards}
        query={page.query}
        library={page.library}
        path={`/board/staff/invitations/${invitation.id}`}
        back={
          <Link
            href={`/board/staff${page.query}`}
            className="inline-flex min-h-11 items-center text-sm text-slate-600 hover:text-slate-900"
          >
            ← {t('back')}
          </Link>
        }
      />
      <div className="max-w-2xl space-y-4">
        <Card>
          <CardBody className="space-y-1 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium text-slate-900">{invitation.displayName}</p>
              <StaffStatusBadge status={invitation.status} />
            </div>
            <p className="text-sm break-all text-slate-600">{invitation.email}</p>
            <p className="text-sm text-slate-700">
              {tStaff('roleAt', { role: tRoles(invitation.role), place })}
            </p>
          </CardBody>
        </Card>

        {invitation.status === 'pending' ? (
          <>
            <InvitationStatus invitationId={invitation.id} />
            <CancelInvitationButton invitationId={invitation.id} name={invitation.displayName} />
          </>
        ) : invitation.status === 'ready' && invitation.immediate ? (
          <Notice tone="success">{t('readyExisting', { name: invitation.displayName })}</Notice>
        ) : invitation.status === 'ready' && messages ? (
          <section aria-labelledby="invite-ready" className="space-y-3">
            <h2 id="invite-ready" className="font-semibold text-slate-900">
              {t('ready', { name: invitation.displayName })}
            </h2>
            <InviteMessageCard
              messages={messages}
              initialLocale={isLocale(lang) ? lang : isLocale(locale) ? locale : 'fr-CA'}
            />
          </section>
        ) : invitation.status === 'failed' ? (
          <Notice tone="danger">
            <p className="font-medium">{t('failedState')}</p>
            <p>
              {failure === 'expired'
                ? tErrors('invitationExpired')
                : failure
                  ? tErrors(failure)
                  : tErrors('unexpected')}
            </p>
          </Notice>
        ) : (
          <Notice tone="info">{t('cancelledState')}</Notice>
        )}
      </div>
    </div>
  );
}
