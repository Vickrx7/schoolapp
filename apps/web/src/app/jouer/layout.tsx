import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
};

/**
 * The student shell of « Quiz sur les appareils » (DECISIONS D-083, D-090): no account, no staff
 * navigation, always in French (`i18n/request.ts` serves only the `classPortal` messages here),
 * 22 px base type and big targets for a noisy classroom. Content carries its own language on the
 * elements that show it. The pages reach the database only through the class portal role
 * (eslint.config.mjs forbids anything else under app/jouer).
 */
export default function JouerLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="fr-CA" className="min-h-dvh bg-white text-[22px] leading-snug text-slate-950">
      <main className="mx-auto max-w-4xl px-4 pt-6 pb-[calc(3rem+env(safe-area-inset-bottom))] sm:px-6">
        {children}
      </main>
    </div>
  );
}
