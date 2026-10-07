'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { deleteNewsletter } from '@/server/actions/newsletters';

/** « Supprimer » (DECISIONS D-138: a message is deletable at any time), then back to the list. */
export function DeleteNewsletterButton({
  classId,
  id,
  weekLabel,
  onDeleted,
}: {
  classId: string;
  id: string;
  /** « 5 octobre » */
  weekLabel: string;
  onDeleted?: () => void;
}) {
  const t = useTranslations('newsletter.editor');
  const router = useRouter();
  const remove = useAction(deleteNewsletter);
  return (
    <ConfirmButton
      label={t('delete')}
      message={t('deleteMessage', { date: weekLabel })}
      confirmLabel={t('delete')}
      size="md"
      onConfirm={async () => {
        const result = await remove.run(id);
        if (result?.ok) {
          onDeleted?.();
          toast.success(t('deleted'));
          router.push(`/classes/${classId}/info-parents`);
        }
      }}
    />
  );
}
