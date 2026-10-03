'use client';

import { useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { cancelInvitation } from '@/server/actions/board';

/** « Annuler l'invitation » while the account is being prepared (DECISIONS D-107). */
export function CancelInvitationButton({
  invitationId,
  name,
}: {
  invitationId: string;
  name: string;
}) {
  const t = useTranslations('board.invite');
  const cancel = useAction(cancelInvitation, { successMessage: t('cancelled') });
  return (
    <ConfirmButton
      label={t('cancel')}
      message={t('cancelConfirm', { name })}
      confirmLabel={t('cancel')}
      size="md"
      onConfirm={() => cancel.run(invitationId)}
    />
  );
}
