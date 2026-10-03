import { TYPE_INFO } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { PdfLink } from '@/components/sub-plans/pdf-link';
import type { LibraryItemView } from '@/server/library/view-model';
import { libraryPdfHref } from '@/server/pdf/library-model';

/**
 * « Télécharger le PDF » (slice S7, D-075, D-053): plain `<a>` links to
 * `/library/items/<id>/pdf?doc&v` (never prefetched; `download=1` saves the file, and a failure
 * comes back as a page with a way back, never as a saved file). Rendered on the server once per
 * version on the item page (in the action row, for the version on screen: `versionIds` is that
 * one version) and once on the print page (the versions chosen there, in version order).
 *
 * The slot does not know which document is on screen, so it offers both, each named for what it
 * holds: « PDF de la feuille de l’élève » (never a key) and « PDF du guide et du corrigé ». A
 * resource without a student sheet (`lesson_plan`, `teacher_guide`) has only its guide:
 * « Télécharger le PDF ». Messages: `libraryItem.pdf.*`.
 */
export function PdfSlot({ item, versionIds }: { item: LibraryItemView; versionIds: string[] }) {
  const t = useTranslations('libraryItem.pdf');
  if (!item.versions.length) return null;
  const hasStudentSheet = TYPE_INFO[item.type].audience !== 'teacher';
  return (
    <>
      {hasStudentSheet ? (
        <PdfLink
          href={libraryPdfHref(item.id, 'student', versionIds)}
          label={t('student')}
          save
          testId="library-pdf-student"
        />
      ) : null}
      <PdfLink
        href={libraryPdfHref(item.id, 'teacher', versionIds)}
        label={hasStudentSheet ? t('teacher') : t('download')}
        save
        testId="library-pdf-teacher"
      />
    </>
  );
}
