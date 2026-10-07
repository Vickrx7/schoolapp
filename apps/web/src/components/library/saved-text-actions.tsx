'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { deleteLibraryItem } from '@/server/actions/library';

/**
 * « Supprimer » for a text saved from « Texte différencié » opened outside the library (a school
 * without the Library module, DECISIONS D-073, D-078): the one workflow action it keeps.
 */
export function SavedTextActions({ itemId }: { itemId: string }) {
  const t = useTranslations('libraryEdit.workflow');
  const router = useRouter();
  const remove = useAction(deleteLibraryItem, {
    successMessage: t('deleteDone'),
    onSuccess: () => router.push('/differentiate'),
  });
  return (
    <div className="print:hidden">
      <ConfirmButton
        label={t('delete')}
        message={t('deleteConfirm')}
        confirmLabel={t('delete')}
        size="md"
        onConfirm={() => remove.run(itemId)}
      >
        <Trash2 aria-hidden />
        {t('delete')}
      </ConfirmButton>
    </div>
  );
}
