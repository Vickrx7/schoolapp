/**
 * The navigation's items, which of them fit the phone's bottom bar, and which one is active.
 * Pure, so the rules are unit-tested.
 */

/**
 * In the order of the top bar (DECISIONS D-118): today, classes, direction, substitutes,
 * library, differentiate, calendar, school, board, profile.
 */
export type NavKey =
  | 'today'
  | 'classes'
  | 'direction'
  | 'substitutes'
  | 'library'
  | 'differentiate'
  | 'calendar'
  | 'school'
  | 'board'
  | 'profile';

/** What fits the phone's bottom bar at 360 px (D-034: 44 px targets, labels readable). */
export const PHONE_BAR_MAX = 6;

/**
 * The phone's bottom bar, from the items of the top bar, in the same order (DECISIONS D-078,
 * kept by D-118 with « Direction » and « Conseil »):
 *
 * - every item when they fit (six places), except that the direction's bar leaves
 *   « Suppléances » out (its dashboard links the board: « Ouvrir le tableau des suppléances »):
 *   six labels at 360 px left no room between « Suppléances » and its neighbours (Phase 6
 *   review);
 * - otherwise « Suppléances » is left out first: phones reach it from Aujourd'hui and École,
 *   and it stays on the top bar from tablet width (a teaching principal: six places again);
 * - if there are still too many, the first five items and « Plus », a sheet with the rest
 *   (« Suppléances » included then, since the sheet exists anyway).
 *
 * `more` is empty when there is no « Plus ».
 */
export function phoneBar<T extends { key: NavKey }>(items: readonly T[]): { bar: T[]; more: T[] } {
  if (items.length === PHONE_BAR_MAX && items.some((i) => i.key === 'direction'))
    return { bar: items.filter((i) => i.key !== 'substitutes'), more: [] };
  if (items.length <= PHONE_BAR_MAX) return { bar: [...items], more: [] };
  const without = items.filter((i) => i.key !== 'substitutes');
  if (without.length <= PHONE_BAR_MAX) return { bar: without, more: [] };
  const bar = without.slice(0, PHONE_BAR_MAX - 1);
  return { bar, more: items.filter((i) => !bar.includes(i)) };
}

/**
 * Whether an item is the current page. « Ressources » also covers « Texte différencié »
 * (`/differentiate/*`), which lives inside the library when the library is shown (D-078).
 * « Journal d'audit » (`/audit`) belongs to « Direction » when the person has it, else to
 * « Conseil » (`shown`: the keys of the items the person has).
 */
export function isNavActive(
  item: { key: NavKey; href: string },
  pathname: string,
  shown: readonly NavKey[] = [],
): boolean {
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (under('/audit')) {
    return item.key === 'direction' || (item.key === 'board' && !shown.includes('direction'));
  }
  return under(item.href) || (item.key === 'library' && under('/differentiate'));
}
