/**
 * The navigation's items, which of them fit the phone's bottom bar, and which one is active.
 * Pure, so the rules are unit-tested.
 */

export type NavKey =
  | 'today'
  | 'classes'
  | 'substitutes'
  | 'library'
  | 'differentiate'
  | 'calendar'
  | 'school'
  | 'profile';

/** What fits the phone's bottom bar at 360 px (D-034: 44 px targets, labels readable). */
export const PHONE_BAR_MAX = 6;

/**
 * The phone's bottom bar, from the items of the top bar, in the same order (DECISIONS D-078):
 *
 * - every item when they fit (six places);
 * - otherwise « Suppléances » is left out first: phones reach it from Aujourd'hui and École,
 *   and it stays on the top bar from tablet width (a teaching principal: six places again);
 * - if there are still too many, the first five items and « Plus », a sheet with the rest
 *   (« Suppléances » included then, since the sheet exists anyway).
 *
 * `more` is empty when there is no « Plus ».
 */
export function phoneBar<T extends { key: NavKey }>(items: readonly T[]): { bar: T[]; more: T[] } {
  if (items.length <= PHONE_BAR_MAX) return { bar: [...items], more: [] };
  const without = items.filter((i) => i.key !== 'substitutes');
  if (without.length <= PHONE_BAR_MAX) return { bar: without, more: [] };
  const bar = without.slice(0, PHONE_BAR_MAX - 1);
  return { bar, more: items.filter((i) => !bar.includes(i)) };
}

/**
 * Whether an item is the current page. « Ressources » also covers « Texte différencié »
 * (`/differentiate/*`), which lives inside the library when the library is shown (D-078).
 */
export function isNavActive(item: { key: NavKey; href: string }, pathname: string): boolean {
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return under(item.href) || (item.key === 'library' && under('/differentiate'));
}
