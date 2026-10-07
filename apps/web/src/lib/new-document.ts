/**
 * Opens a page of the app as a new document instead of a client-side navigation, so nothing of
 * the current page stays in the tab (its server payload and the router cache). Class mode uses
 * it on purpose (DECISIONS D-082, D-086): the projector must not keep the item page's answer
 * key, and a class device must load its game with its new cookie and drop the previous game.
 */
export function openAsNewDocument(path: string): void {
  window.location.assign(new URL(path, window.location.origin).href);
}
