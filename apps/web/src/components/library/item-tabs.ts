/**
 * The item page's tabs, shared by the page (server) and its viewer (client). Its own module,
 * without dependencies: a constant exported from a client module is not usable on the server.
 */
export const ITEM_TABS = ['student', 'teacher', 'details'] as const;
export type ItemTab = (typeof ITEM_TABS)[number];

export function isItemTab(value: unknown): value is ItemTab {
  return typeof value === 'string' && (ITEM_TABS as readonly string[]).includes(value);
}
