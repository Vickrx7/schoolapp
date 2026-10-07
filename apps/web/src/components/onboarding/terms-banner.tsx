'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Notice } from '@/components/ui/card';
import { welcomeHref } from '@/lib/request-path';

/**
 * Newer pilot terms than the ones accepted (DECISIONS D-109): a banner on every page of the app,
 * never a block, so a sick teacher at 6 a.m. is never stopped. « Lire et accepter » opens
 * « Bienvenue » and comes back here.
 */
export function TermsBanner() {
  const t = useTranslations('legal');
  const pathname = usePathname();
  return (
    <Notice
      tone="warning"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden"
      data-testid="terms-banner"
    >
      <span className="flex items-center gap-2">
        <FileText className="size-4 shrink-0" aria-hidden />
        {t('bannerText')}
      </span>
      <Link
        href={welcomeHref(pathname)}
        className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
      >
        {t('bannerAction')}
      </Link>
    </Notice>
  );
}
