import { expect, test, type Page } from '@playwright/test';
import { closeDb } from './db';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Banque de ressources » on a phone (Phase 4, DECISIONS D-068, D-078): the bottom bar's
 * « Ressources », searching, the « Filtres » sheet and a resource's page, with no horizontal
 * scrolling. Read-only on the demo resources of the seed. (Adding to the planning from a phone
 * comes with the planning screens.)
 */

const HUARD = 'Le huard, oiseau des lacs';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.afterAll(async () => {
  await closeDb();
});

test('finding a resource on a phone', async ({ page }) => {
  await login(page, DEMO.teacher3);
  const bar = page.getByRole('navigation', { name: 'Navigation principale' }).last();
  await bar.getByRole('link', { name: 'Ressources' }).click();
  await page.waitForURL(/\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Banque de ressources' })).toBeVisible();
  await noHorizontalScroll(page);
  await expectAccessible(page);

  // Search « huard »: results as the words are typed.
  const field = page.getByRole('searchbox', { name: 'Rechercher une ressource' });
  await expect(async () => {
    await field.fill('huard');
    await expect(page).toHaveURL(/q=huard/, { timeout: 2000 });
  }).toPass();
  const results = page.getByRole('region', { name: 'Résultats' });
  await expect(results.getByRole('link', { name: HUARD })).toBeVisible();
  // The side panel is for larger screens; phones get « Filtres ».
  await expect(page.getByRole('complementary', { name: 'Filtres' })).toBeHidden();
  await noHorizontalScroll(page);
  await expectAccessible(page);

  // The filter sheet opens, filters, and closes on « Voir les … ressources ».
  await page.getByRole('button', { name: 'Filtres', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Filtres' });
  await expect(sheet).toBeVisible();
  await expectAccessible(page);
  await sheet.getByRole('checkbox', { name: /^Pour la suppléance/ }).check();
  await expect(page).toHaveURL(/sub=1/);
  await sheet.getByRole('button', { name: /^Voir (les \d+ ressources|\d+ ressource)$/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Filtres (1)' })).toBeVisible();
  await expect(results.getByRole('link', { name: HUARD })).toBeVisible();
  await noHorizontalScroll(page);

  // The resource's page fits the phone too.
  await results.getByRole('link', { name: HUARD }).click();
  await page.waitForURL(/\/library\/items\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: HUARD })).toBeVisible();
  await noHorizontalScroll(page);
  await expectAccessible(page);
});

test('browsing the curriculum on a phone', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/library/curriculum?grade=3');
  await page
    .getByRole('list', { name: 'Matières' })
    .getByRole('link', { name: 'Français', exact: true })
    .click();
  const strand = page.locator('details').filter({ hasText: /^Domaine C — / });
  await strand.locator('summary').click();
  await expect(strand.getByText('C1.2', { exact: true })).toBeVisible();
  await noHorizontalScroll(page);
  await expectAccessible(page);
});
