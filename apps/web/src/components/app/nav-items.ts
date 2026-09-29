/**
 * The navigation's items, and which of them fit the phone's bottom bar. Pure, so the rule is
 * unit-tested.
 */

export type NavKey =
  'today' | 'classes' | 'substitutes' | 'differentiate' | 'calendar' | 'school' | 'profile';

/** What fits the phone's bottom bar at 360 px (D-034: 44 px targets, labels readable). */
export const PHONE_BAR_MAX = 6;

/**
 * The items of the phone bar, from the items of the top bar, in the same order. When there are
 * more than six (a teaching principal, or a teacher who is also office staff), « Suppléances »
 * is left out: phones reach it from Aujourd'hui and École, and it stays on the top bar from
 * tablet width. Profil (language, sign-out) and École are never left out.
 */
export function phoneBarItems<T extends { key: NavKey }>(items: T[]): T[] {
  if (items.length <= PHONE_BAR_MAX) return items;
  const without = items.filter((i) => i.key !== 'substitutes');
  if (without.length <= PHONE_BAR_MAX) return without;
  // Not reachable with today's items; keep Profil in any case.
  return [...without.slice(0, PHONE_BAR_MAX - 1), ...without.filter((i) => i.key === 'profile')];
}
