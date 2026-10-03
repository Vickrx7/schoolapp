import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDb } from './db';
import { DEMO_ITEMS, clearOpinion, deleteAdaptations, opinionCount } from './db-library-growth';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Votre avis » and « Adapter » on a phone (Phase 5, DECISIONS D-092, D-093), by the principal
 * (direction gives opinions too): 44 px stars, the adaptation dialog as a bottom sheet, the
 * editor it opens, and no horizontal scrolling. On a demo resource of the seed; the opinion and
 * the adaptation made here are deleted afterwards.
 */

const { cabane } = DEMO_ITEMS;

test.beforeAll(async () => {
  await clearOpinion(cabane.id, DEMO.principal);
});

test.afterAll(async () => {
  await clearOpinion(cabane.id, DEMO.principal);
  await deleteAdaptations(cabane.id, DEMO.principal);
  await closeDb();
});

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A tap before the page is interactive is lost: retry until the sheet opens. */
async function openDialog(page: Page, trigger: Locator) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test('the principal gives an opinion and adapts a resource on a phone', async ({ page }) => {
  test.setTimeout(90_000);
  const others = await opinionCount(cabane.id, DEMO.principal);
  await login(page, DEMO.principal);
  await page.goto(`/library/items/${cabane.id}`);
  await expect(page.getByRole('heading', { level: 1, name: cabane.title })).toBeVisible();

  const section = page.getByRole('region', { name: 'Votre avis' });
  await section.scrollIntoViewIfNeeded();
  const five = section.getByRole('radio', { name: '5 étoiles sur 5' });
  // Each star is a 44 px target.
  const box = await five.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect(async () => {
    await five.check();
    await expect(five).toBeChecked({ timeout: 1000 });
  }).toPass();
  await expect(section.getByText('Votre avis est enregistré.')).toBeVisible();
  expect(await opinionCount(cabane.id)).toBe(others + 1);
  await noHorizontalScroll(page);
  await expectAccessible(page);

  const sheet = await openDialog(
    page,
    page.getByRole('button', { name: 'Adapter cette ressource' }),
  );
  await noHorizontalScroll(page);
  await expectAccessible(page);
  await sheet.getByRole('button', { name: 'Créer mon adaptation' }).click();
  await page.waitForURL(/\/library\/items\/[0-9a-f-]{36}\/edit$/);
  await expect(
    page.getByRole('link', { name: `Adaptée de « ${cabane.title} »`, exact: true }),
  ).toBeVisible();
  await noHorizontalScroll(page);
});
