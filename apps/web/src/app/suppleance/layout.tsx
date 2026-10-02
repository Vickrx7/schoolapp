import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LanguageSwitch } from '@/components/app/language-switch';
import { APP_NAME } from '@/lib/app-name';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * The substitute portal's chrome (DECISIONS D-049): no account, no staff navigation, and the
 * FR/EN switch. Plan content stays in French whatever the interface language. The footer links
 * to « Confidentialité » (D-110).
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('legal');
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="font-bold text-slate-900">{APP_NAME}</span>
          <span className="ml-auto">
            <LanguageSwitch portal />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] text-sm print:hidden">
        {/* The notice leads back here, not to the staff sign-in (D-110). */}
        <Link
          href="/confidentialite?from=suppleance"
          className="inline-flex min-h-11 items-center text-slate-600 underline underline-offset-2 hover:text-slate-900"
        >
          {t('footerLink')}
        </Link>
      </footer>
    </div>
  );
}
