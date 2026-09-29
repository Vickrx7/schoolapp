/**
 * « Maintenant » and « Ensuite » on the substitute's plan: which block is under way and which
 * comes next, from the device's clock on the school's time zone. Shown on the plan date only.
 * Pure, so it can be unit tested.
 */
import { timeToMinutes, type LocalDate, type LocalTime } from '@lynx/domain';

export interface TimelineBlock {
  key: string;
  start: LocalTime;
  end: LocalTime;
  title: string;
}

export type TimelineState<B extends TimelineBlock> =
  | { kind: 'otherDay' }
  | { kind: 'before'; next: B }
  | { kind: 'during'; now: B | null; next: B | null }
  | { kind: 'after' };

/**
 * `today` and `minutes` are the school-local date and minutes since midnight of the device's
 * clock. Between two blocks, `now` is null and `next` is the coming one. When blocks overlap,
 * the one that started last is « Maintenant ».
 */
export function timelineState<B extends TimelineBlock>(
  blocks: readonly B[],
  planDate: LocalDate,
  today: LocalDate,
  minutes: number,
): TimelineState<B> {
  if (today !== planDate || blocks.length === 0) return { kind: 'otherDay' };
  const sorted = [...blocks].sort(
    (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start) || a.end.localeCompare(b.end),
  );
  if (minutes < timeToMinutes(sorted[0]!.start)) return { kind: 'before', next: sorted[0]! };
  const lastEnd = Math.max(...sorted.map((b) => timeToMinutes(b.end)));
  if (minutes >= lastEnd) return { kind: 'after' };
  const current = sorted.filter(
    (b) => timeToMinutes(b.start) <= minutes && minutes < timeToMinutes(b.end),
  );
  const now = current.at(-1) ?? null;
  const next = sorted.find((b) => timeToMinutes(b.start) > minutes) ?? null;
  return { kind: 'during', now, next };
}
