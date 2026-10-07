import { Library } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { libraryHref } from '@/server/library/search-params';

/**
 * « Joindre une ressource » on a lesson of Planification (DECISIONS D-076): the library's results
 * for the class's grade, the unit's subject and the lesson's first attente, with every card
 * offering « Joindre à cette leçon » (`attachTo`).
 */
export function AttachResourceLink({
  lessonId,
  lessonNumber,
  gradeCode,
  subjectId,
  expectationId,
}: {
  lessonId: string;
  lessonNumber: number;
  gradeCode: string | null;
  subjectId: string | null;
  expectationId: string | null;
}) {
  const t = useTranslations('libraryPlanning.lessonRow');
  const href = libraryHref({
    grade: gradeCode,
    subject: subjectId,
    exp: expectationId,
    attachTo: lessonId,
  });
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
      aria-label={t('attachNamed', { n: lessonNumber })}
    >
      <Library className="size-4" aria-hidden />
      {t('attach')}
    </Link>
  );
}
