import { FeedbackButton } from '@/components/feedback/feedback-button';
import type { SessionContext } from '@/server/session';

/**
 * The actions at the right of the top bar, on every page of the signed-in app: « Commentaires »
 * (DECISIONS D-116), which opens the shell's feedback dialog (`FeedbackProvider`).
 */
export async function HeaderActionsSlot({ session: _session }: { session: SessionContext }) {
  return <FeedbackButton />;
}
