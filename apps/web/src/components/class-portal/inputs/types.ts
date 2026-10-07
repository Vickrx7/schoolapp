import type { ClassAnswer, DeviceQuestion } from '../../../server/class-portal/schemas';

/**
 * What every answer input of a class device receives (DECISIONS D-086, D-088): the question as
 * the snapshot has it (never a key), the content's language, and where to send the answer. What
 * a student types or picks stays in the input's own state until it is sent, never in the
 * browser's storage.
 */
export interface AnswerInputProps<K extends DeviceQuestion['kind']> {
  question: DeviceQuestion;
  /** The content's language (`en-CA` for Anglais); the screen around it stays French. */
  lang: 'fr-CA' | 'en-CA';
  /** While an answer is on its way, or once the question closed. */
  disabled: boolean;
  onSubmit: (response: ClassAnswer<K>) => void;
}

/** Big, high-contrast targets for a noisy classroom (D-090): at least 64 px. */
export const BIG_BUTTON =
  'inline-flex min-h-16 items-center justify-center gap-3 rounded-2xl px-6 text-[24px] font-bold focus-visible:outline-4 focus-visible:outline-offset-4 disabled:opacity-60';
