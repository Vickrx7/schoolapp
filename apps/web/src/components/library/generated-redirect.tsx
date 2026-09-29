'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Notice } from '@/components/ui/card';
import { forgetSentDrafts } from '@/hooks/use-draft';

/**
 * A request of « Créer avec l’IA » succeeded: the form's draft that became it is forgotten
 * (D-035), then the new resource opens. The link stays for a browser that does not follow.
 */
export function GeneratedRedirect({
  href,
  draftPrefix,
  jobId,
}: {
  href: string;
  draftPrefix: string;
  jobId: string;
}) {
  const t = useTranslations('libraryAi.job');
  const router = useRouter();
  useEffect(() => {
    forgetSentDrafts(draftPrefix, jobId);
    router.replace(href);
  }, [draftPrefix, jobId, href, router]);
  return (
    <Notice tone="success" className="flex flex-wrap items-center gap-2">
      <CircleCheck className="size-4" aria-hidden />
      <span>{t('ready')}</span>
      <Link href={href} className="font-medium underline">
        {t('open')}
      </Link>
    </Notice>
  );
}
