import { expect, test, type Page } from '@playwright/test';
import { closeDb, query } from './db';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Banque de ressources » on a phone (Phase 4, DECISIONS D-068, D-076, D-078): the bottom
 * bar's « Ressources », searching, the « Filtres » sheet, a resource's page and « Ajouter à ma
 * planification », with no horizontal scrolling. On the demo resources of the seed; the lesson
 * link added here is removed afterwards.
 */

const HUARD = 'Le huard, oiseau des lacs';
/** 3e année, Français: « Lire pour s’informer : les animaux de l’Ontario » (supabase/seed.sql). */
const UNIT_FRA_3 = '30000000-0000-4000-8000-000000000301';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.afterAll(async () => {
  await query(
    `update public.unit_lessons set library_item_id = null
     where unit_id = $1 and library_item_id = (select id from public.library_items where title = $2)`,
    [UNIT_FRA_3, HUARD],
  );
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
  await page.waitForURL(/\/library\/items\/[0-9a-f-]{36}\?q=huard&sub=1$/);
  await expect(page.getByRole('heading', { level: 1, name: HUARD })).toBeVisible();
  await noHorizontalScroll(page);
  await expectAccessible(page);
});

test('clearing the last filter with no words closes the sheet and keeps the focus', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await page.goto('/library?sub=1');
  await page.getByRole('button', { name: 'Filtres (1)' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filtres' });
  await expect(sheet).toBeVisible();
  // The last filter goes: nothing is left to show results for, so the page is the hub again.
  // A click, not `uncheck()`: the sheet closes with it, so the box is gone once it has worked.
  await sheet.getByRole('checkbox', { name: /^Pour la suppléance/ }).click();
  await expect(sheet).toBeHidden();
  await page.waitForURL(/\/library$/);
  await expect(page.getByText('Filtres effacés : retour à la banque de ressources.')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Rechercher une ressource' })).toBeFocused();
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

test('adding a resource to the planning on a phone takes four taps or fewer', async ({ page }) => {
  await login(page, DEMO.teacher3);
  // Taps the teacher makes (a retry of a tap lost before the page is interactive is not one).
  let taps = 0;
  await page.goto('/library?q=huard');
  const results = page.getByRole('region', { name: 'Résultats' });
  taps++;
  await results.getByRole('link', { name: HUARD }).click();
  await page.waitForURL(/\/library\/items\/[0-9a-f-]{36}\?q=huard$/);

  // Everything is chosen already: 3e année, Français, the next lesson that shares an attente.
  const open = page.getByRole('button', { name: 'Ajouter à ma planification' });
  const dialog = page.getByRole('dialog', { name: 'Ajouter à ma planification' });
  taps++;
  await expect(async () => {
    if (!(await dialog.isVisible())) await open.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  const submit = dialog.getByRole('button', { name: 'Joindre à la leçon 4' });
  await expect(submit).toBeEnabled();
  await expect(dialog.getByLabel('Unité')).toContainText('Français');
  await noHorizontalScroll(page);
  await expectAccessible(page);
  taps++;
  await submit.click();
  await expect(page.getByText('Jointe à la leçon 4.')).toBeVisible();
  expect(taps).toBeLessThanOrEqual(4);

  const linked = await query<{ sequence_number: number }>(
    `select l.sequence_number from public.unit_lessons l
     join public.library_items i on i.id = l.library_item_id
     where l.unit_id = $1 and i.title = $2`,
    [UNIT_FRA_3, HUARD],
  );
  expect(linked.map((l) => l.sequence_number)).toEqual([4]);
});
