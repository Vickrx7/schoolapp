import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LanguageSwitch } from '@/components/app/language-switch';
import { APP_NAME } from '@/lib/app-name';
import { requireSession } from '@/server/session';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * « Bienvenue » (DECISIONS D-109): outside the app's shell, since the app waits for the pilot
 * terms. Signed-in staff only, before the terms (`beforeTerms`).
 */
export default async function WelcomeLayout({ children }: { children: ReactNode }) {
  await requireSession({ beforeTerms: true });
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="font-bold text-slate-900">{APP_NAME}</span>
          <span className="ml-auto">
            <LanguageSwitch />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-12">{children}</main>
    </div>
  );
}
