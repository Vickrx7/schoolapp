'use client';

import { useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { deleteCalendarEvent } from '@/server/actions/calendar';

export function DeleteEventButton({ eventId, title }: { eventId: string; title: string }) {
  const t = useTranslations('calendar');
  const tCommon = useTranslations('common');
  const remove = useAction(deleteCalendarEvent, { successMessage: t('deleted') });
  return (
    <ConfirmButton
      label={tCommon('delete')}
      message={t('deleteConfirm', { title })}
      confirmLabel={tCommon('delete')}
      variant="ghost"
      onConfirm={() => remove.run(eventId)}
    />
  );
}
