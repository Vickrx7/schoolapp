'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { deleteSessionResults } from '@/server/actions/class-mode';

/** « Supprimer » on kept results: the session and its class counts go (D-089). */
export function DeleteResultsButton({
  sessionId,
  classId,
}: {
  sessionId: string;
  classId: string;
}) {
  const t = useTranslations('classMode.results');
  const router = useRouter();
  const remove = useAction(deleteSessionResults, {
    onSuccess: () => {
      toast.success(t('deleted'));
      router.push(`/classes/${classId}/class-mode`);
    },
  });
  return (
    <ConfirmButton
      label={t('delete')}
      message={t('deleteConfirm')}
      confirmLabel={t('delete')}
      size="md"
      disabled={remove.pending}
      onConfirm={() => remove.run(sessionId)}
    >
      <Trash2 aria-hidden />
      {t('delete')}
    </ConfirmButton>
  );
}
