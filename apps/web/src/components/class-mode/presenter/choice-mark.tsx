import type { TeamShape } from '@lynx/content';
// Relative, so the unit test can render it without the app's path alias.
import { cn } from '../../../lib/utils';

/**
 * The mark of an answer choice on the projector (DECISIONS D-090): a letter, a shape and a
 * colour, so a choice never depends on colour alone and reads from the back of the room on a
 * washed-out projector. The shapes and colours follow `CLASS_TEAMS` (`@lynx/content`) in order,
 * so choice A is always the blue circle and B the orange triangle, as on the devices of
 * « Quiz sur les appareils » (slice S3 can switch the classes to its `--color-team-*` tokens).
 * Only types are imported from `@lynx/content`, so the content package stays out of the player's
 * bundle; a unit test pins the order to `CLASS_TEAMS`.
 */

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const CHOICE_MARKS: readonly { shape: TeamShape; fill: string }[] = [
  { shape: 'circle', fill: 'fill-blue-700' },
  { shape: 'triangle', fill: 'fill-orange-600' },
  { shape: 'square', fill: 'fill-green-700' },
  { shape: 'diamond', fill: 'fill-purple-700' },
  { shape: 'star', fill: 'fill-slate-600' },
  { shape: 'hexagon', fill: 'fill-red-700' },
];

/** The shapes' outlines (24 × 24), shared with the quiz on devices (`../team-mark.tsx`). */
export const SHAPE_PATHS: Record<TeamShape, string> = {
  circle: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z',
  triangle: 'M12 2.5 22.5 21h-21Z',
  square: 'M3 3h18v18H3Z',
  diamond: 'M12 1.5 22.5 12 12 22.5 1.5 12Z',
  star: 'M12 1.8 14.9 8.6l7.3.6-5.6 4.8 1.7 7.2L12 17.3l-6.3 3.9 1.7-7.2L1.8 9.2l7.3-.6Z',
  hexagon: 'M6.5 2.5h11L23 12l-5.5 9.5h-11L1 12Z',
};

/** The shape alone, decorative (the letter or the text says the same thing). */
export function ChoiceShape({ index, className }: { index: number; className?: string }) {
  const mark = CHOICE_MARKS[index % CHOICE_MARKS.length]!;
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      data-shape={mark.shape}
      className={cn('size-[1.1em] shrink-0', mark.fill, className)}
    >
      <path d={SHAPE_PATHS[mark.shape]} />
    </svg>
  );
}

/** The shape and the letter of the choice at `index` (« A », « B »…). */
export function ChoiceMark({ index }: { index: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[0.35em] font-bold tabular-nums">
      <ChoiceShape index={index} />
      <span>{CHOICE_LETTERS[index] ?? String(index + 1)}</span>
    </span>
  );
}
