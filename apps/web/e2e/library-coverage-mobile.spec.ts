import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDb } from './db';
import { subjectId } from './db-coverage';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Couverture du curriculum » on a phone (Phase 5, DECISIONS D-094), by the principal (direction
 * reads coverage too): the overview scrolls in its own container, the filters open as a bottom
 * sheet, and the page never scrolls sideways. Read-only on the demo resources of the seed.
 */

/** The level badges of attentes that have approved resources (« Peu : 1 … », « 3 … »). */
const WITH_APPROVED = /^(Peu\s: )?\d+ ressources? approuvées?$/;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A tap before the page is interactive is lost: retry until the sheet opens. */
async function openSheet(page: Page, trigger: Locator) {
  const sheet = page.getByRole('dialog', { name: 'Filtres' });
  await expect(async () => {
    if (!(await sheet.isVisible())) await trigger.click();
    await expect(sheet).toBeVisible({ timeout: 1000 });
  }).toPass();
  return sheet;
}

test.afterAll(async () => {
  await closeDb();
});

test('coverage on a phone: the filters in a bottom sheet, no sideways scrolling', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, DEMO.principal);
  await page.goto(`/library/coverage?grade=3&subject=${await subjectId('mat')}`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Mathématiques · 3e année' }),
  ).toBeVisible();
  // The overview is there; it scrolls inside its own box when it is wider than the screen.
  await expect(
    page.getByRole('region', { name: /^Attentes qui ont au moins une ressource approuvée/ }),
  ).toBeVisible();
  await noHorizontalScroll(page);
  await expectAccessible(page);

  // Phones get « Filtres » (the filters beside the list are for larger screens).
  await expect(page.getByRole('list', { name: 'Afficher' })).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Filtres', exact: true });
  const box = await trigger.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Counted before the sheet opens: the open sheet is modal, so the page behind it is hidden
  // from assistive technology (and from role locators).
  const withApproved = page.getByRole('main').getByRole('listitem').getByText(WITH_APPROVED);
  expect(await withApproved.count()).toBeGreaterThan(0);
  let sheet = await openSheet(page, trigger);
  await noHorizontalScroll(page);
  await expectAccessible(page);

  // « Sans ressource approuvée » closes the sheet and narrows the list.
  await sheet
    .getByRole('list', { name: 'Afficher' })
    .getByRole('link', { name: 'Sans ressource approuvée' })
    .click();
  await expect(page).toHaveURL(/show=none/);
  await expect(sheet).toBeHidden();
  await expect(withApproved).toHaveCount(0);

  // « Seuil » 3, then « Voir les attentes » closes the sheet.
  sheet = await openSheet(page, trigger);
  await sheet
    .getByRole('list', { name: 'Seuil' })
    .getByRole('link', { name: '3', exact: true })
    .click();
  await expect(page).toHaveURL(/show=none&min=3/);
  await expect(page.getByText('Sans ressource approuvée · Seuil 3', { exact: true })).toBeVisible();
  sheet = await openSheet(page, trigger);
  await sheet.getByRole('button', { name: 'Voir les attentes' }).click();
  await expect(sheet).toBeHidden();
  await noHorizontalScroll(page);

  // The narrowest phones the app supports (360 px), with every attente listed.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/library/coverage?grade=3&subject=${await subjectId('mat')}`);
  await expect(
    page.getByText(/^\d+ attentes? sur \d+ (a|ont) au moins une ressource approuvée\.$/),
  ).toBeVisible();
  await noHorizontalScroll(page);
});
