import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NarrowNotice } from '@/components/class-mode/presenter/narrow-notice';
import { requireSession } from '@/server/session';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The projector shell (DECISIONS D-082, D-090): « Présenter à la classe » and, with slice S3, the
 * quiz on devices. Signed-in staff only (each page checks its own access); no app navigation,
 * white and high contrast for a washed-out classroom projector. The pages need a landscape screen
 * at least 768 px wide: below that (or upright) only « Ouvrez cette page sur l’ordinateur branché
 * au projecteur » shows.
 */
export default async function ProjectorLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <main className="min-h-dvh bg-white text-slate-950">
      <div className="hidden md:landscape:block">{children}</div>
      <div className="md:landscape:hidden">
        <NarrowNotice />
      </div>
    </main>
  );
}
