import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NarrowNotice } from '@/components/class-mode/presenter/narrow-notice';
import { FeedbackProvider } from '@/components/feedback/feedback-provider';
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
  const session = await requireSession();
  return (
    // An error page's « Signaler ce problème » opens « Commentaires » (D-111, D-116).
    <FeedbackProvider userId={session.userId}>
      <main className="min-h-dvh bg-white text-slate-950">
        <div className="hidden md:landscape:block">{children}</div>
        <div className="md:landscape:hidden">
          <NarrowNotice />
        </div>
      </main>
    </FeedbackProvider>
  );
}
