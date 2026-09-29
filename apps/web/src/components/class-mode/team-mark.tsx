import type { ClassTeamKey, TeamShape } from '@lynx/content';
// Relative, so unit tests and the student pages import it without the app's path alias.
import { cn } from '../../lib/utils';
import { SHAPE_PATHS } from './presenter/choice-mark';

/**
 * Teams and answer choices of « Quiz sur les appareils » (DECISIONS D-088, D-090): a colour
 * (`--color-team-*` in globals.css), a shape and a name or a letter, never colour alone. Team i
 * and answer choice i share the colour and the shape of `CLASS_TEAMS[i]` (`@lynx/content`; a unit
 * test pins the order), so choice A is the blue circle on the projector and on every device.
 * White text on each colour is at least 7:1. Only types come from `@lynx/content`, so the student
 * pages do not load the content package.
 */

export interface TeamStyle {
  shape: TeamShape;
  /** Filled background (white text on it). */
  bg: string;
  /** Text in the colour, on white. */
  text: string;
  /** An SVG shape in the colour. */
  fill: string;
  border: string;
  /** A pale background for bars and tiles. */
  soft: string;
}

export const TEAM_ORDER: readonly ClassTeamKey[] = [
  'huards',
  'castors',
  'orignaux',
  'ours',
  'loups',
  'renards',
];

// Full class names (Tailwind finds them in the source).
export const TEAM_STYLES: readonly TeamStyle[] = [
  {
    shape: 'circle',
    bg: 'bg-team-blue',
    text: 'text-team-blue',
    fill: 'fill-team-blue',
    border: 'border-team-blue',
    soft: 'bg-team-blue/10',
  },
  {
    shape: 'triangle',
    bg: 'bg-team-orange',
    text: 'text-team-orange',
    fill: 'fill-team-orange',
    border: 'border-team-orange',
    soft: 'bg-team-orange/10',
  },
  {
    shape: 'square',
    bg: 'bg-team-green',
    text: 'text-team-green',
    fill: 'fill-team-green',
    border: 'border-team-green',
    soft: 'bg-team-green/10',
  },
  {
    shape: 'diamond',
    bg: 'bg-team-purple',
    text: 'text-team-purple',
    fill: 'fill-team-purple',
    border: 'border-team-purple',
    soft: 'bg-team-purple/10',
  },
  {
    shape: 'star',
    bg: 'bg-team-slate',
    text: 'text-team-slate',
    fill: 'fill-team-slate',
    border: 'border-team-slate',
    soft: 'bg-team-slate/10',
  },
  {
    shape: 'hexagon',
    bg: 'bg-team-red',
    text: 'text-team-red',
    fill: 'fill-team-red',
    border: 'border-team-red',
    soft: 'bg-team-red/10',
  },
];

/** Letters of the answer choices (at most 8 per question, `app.class_mode_options`). */
export const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export const teamStyle = (team: ClassTeamKey): TeamStyle =>
  TEAM_STYLES[Math.max(TEAM_ORDER.indexOf(team), 0)]!;

/** Choices past the sixth take the colours and shapes again (their letters differ). */
export const answerStyle = (index: number): TeamStyle =>
  TEAM_STYLES[((index % TEAM_STYLES.length) + TEAM_STYLES.length) % TEAM_STYLES.length]!;

export const answerLetter = (index: number): string => ANSWER_LETTERS[index] ?? String(index + 1);

/** A shape, decorative (a name or a letter always says the same thing). */
export function Shape({ shape, className }: { shape: TeamShape; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      data-shape={shape}
      className={cn('size-[1em] shrink-0 fill-current', className)}
    >
      <path d={SHAPE_PATHS[shape]} />
    </svg>
  );
}

/** A team's shape in its colour. */
export function TeamShapeMark({ team, className }: { team: ClassTeamKey; className?: string }) {
  const style = teamStyle(team);
  return <Shape shape={style.shape} className={cn(style.fill, className)} />;
}

/**
 * A team's name with its shape, in its colour (« ▲ Les Castors »): `name` comes from the
 * `classMode.teams` or `classPortal.teams` messages.
 */
export function TeamLabel({
  team,
  name,
  className,
}: {
  team: ClassTeamKey;
  name: string;
  className?: string;
}) {
  const style = teamStyle(team);
  return (
    <span className={cn('inline-flex items-center gap-[0.35em] font-bold', style.text, className)}>
      <Shape shape={style.shape} className={style.fill} />
      <span>{name}</span>
    </span>
  );
}
