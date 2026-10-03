/**
 * « Commentaires » (DECISIONS D-116), shared by the form and the server action: the kinds, the
 * longest message (the database's check) and the kind of device a message is sent from.
 */
export const FEEDBACK_KINDS = ['problem', 'idea', 'question'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_MAX = 2000;

export type FeedbackDevice = 'phone' | 'tablet' | 'desktop';

/** The kind of device from the window's width (Tailwind's `sm` and `lg` breakpoints). */
export function deviceClass(width: number): FeedbackDevice {
  if (width < 640) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}
