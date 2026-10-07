'use client';

import { useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { setStaffActive } from '@/server/actions/board';

/**
 * « Retirer l'accès » / « Rétablir l'accès » (DECISIONS D-107). Never one's own; the database also
 * refuses someone who works for another board (« écrivez à IP Lynx ») and the board's last admin.
 * The person's classes, plans and resources stay.
 */
export function AccessControls({
  roleId,
  name,
  active,
  self,
}: {
  /** One of the person's roles in the board: how the database names them. */
  roleId: string;
  name: string;
  active: boolean;
  self: boolean;
}) {
  const t = useTranslations('board.person');
  const remove = useAction(setStaffActive, { successMessage: t('accessRemovedSaved') });
  const restore = useAction(setStaffActive, { successMessage: t('accessRestored') });
  return (
    <div className="space-y-3">
      <p className="text-slate-700">{active ? t('accessActive') : t('accessRemoved')}</p>
      {self ? (
        <p className="text-sm text-slate-600">{t('ownAccess')}</p>
      ) : active ? (
        <ConfirmButton
          label={t('removeAccess')}
          message={t('removeAccessConfirm', { name })}
          confirmLabel={t('removeAccess')}
          variant="danger"
          size="md"
          onConfirm={() => remove.run(roleId, false)}
        />
      ) : (
        <ConfirmButton
          label={t('restoreAccess')}
          message={t('restoreAccessConfirm', { name })}
          confirmLabel={t('restoreAccess')}
          size="md"
          tone="primary"
          onConfirm={() => restore.run(roleId, true)}
        />
      )}
    </div>
  );
}
