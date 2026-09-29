import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Notice } from '@/components/ui/card';
import { unitPlanningHref } from '@/server/library/planning-targets';
import type { AttachTarget } from '@/server/library/view-model';

/**
 * The banner above the results while a resource is being chosen for a lesson (slice S6, D-076):
 * « Vous choisissez une ressource pour la leçon 4 « Trouver l’idée principale » », with the way
 * back to the unit's planning. Rendered by S4's results page.
 */
export function ResultsBannerSlot({ attachTo }: { attachTo: AttachTarget | null }) {
  const t = useTranslations('libraryPlanning.banner');
  if (!attachTo) return null;
  return (
    <Notice
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="attach-banner"
    >
      <span>{t('choosing', { n: attachTo.sequenceNumber, title: attachTo.lessonTitle })}</span>
      <Link
        href={unitPlanningHref(attachTo.classId, attachTo.unitId)}
        className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-800 underline-offset-2 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
    </Notice>
  );
}
