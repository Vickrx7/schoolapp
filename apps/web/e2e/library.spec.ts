import { expect, test, type Page } from '@playwright/test';
import { closeDb } from './db';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * Searching and browsing « Banque de ressources » (Phase 4, DECISIONS D-068, D-069), read-only on
 * the demo resources of the seed (content/library/demo): « Le huard, oiseau des lacs » is a
 * board-approved, sub-friendly reading passage for 3e année Français C1.2 with four level
 * versions; « Trouver l’idée principale d’un paragraphe » is an approved lesson plan on the same
 * attente. Other specs may leave resources of their own around, so counts are compared with each
 * other, never with fixed numbers.
 */

const HUARD = 'Le huard, oiseau des lacs';

const mainNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Navigation principale' }).first();
const results = (page: Page) => page.getByRole('region', { name: 'Résultats' });
const filters = (page: Page) => page.getByRole('complementary', { name: 'Filtres' });
/** A result card by its title: another card's summary may name it (the lesson plan's does). */
const resultCard = (page: Page, title: string) =>
  results(page)
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });

/** The number in « 12 ressources », once the results have settled. */
async function resultCount(page: Page): Promise<number> {
  await expect(results(page).locator('[aria-busy="true"]')).toHaveCount(0);
  const text = (await results(page).getByRole('status').textContent()) ?? '';
  return /^Aucune/.test(text) ? 0 : Number(/\d+/.exec(text.replace(/\s/g, ''))?.[0] ?? NaN);
}

/** Every card on screen shows a text: among its badges, or anywhere on the card. */
async function everyCardShows(page: Page, text: string, where: 'badges' | 'card' = 'badges') {
  const cards = results(page).getByRole('article');
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await expect(
      where === 'badges'
        ? card.getByRole('list', { name: 'Caractéristiques de la ressource' })
        : card,
    ).toContainText(text);
  }
}

test.afterAll(async () => {
  await closeDb();
});

test('browsing by attente leads to the approved resources of C1.2', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await mainNav(page).getByRole('link', { name: 'Ressources' }).click();
  await page.waitForURL(/\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Banque de ressources' })).toBeVisible();
  // The hub: her grades, the six categories, the search field.
  await expect(
    page.getByRole('list', { name: 'Mes années d’études' }).getByRole('link', { name: '3e année' }),
  ).toBeVisible();
  const categories = page.getByRole('region', { name: 'Catégories' });
  for (const bucket of ['Enseigner', 'Pratiquer', 'Explorer', 'Évaluer', 'Jouer', 'Relier']) {
    await expect(categories.getByRole('link', { name: new RegExp(`^${bucket}`) })).toBeVisible();
  }
  await expect(page.getByRole('searchbox', { name: 'Rechercher une ressource' })).toBeVisible();
  await expectAccessible(page);

  // « Parcourir par attente » → 3e année → Français → domaine C → C1.2.
  await page.getByRole('link', { name: 'Parcourir par attente' }).click();
  await page.waitForURL(/\/library\/curriculum/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Parcourir le curriculum' }),
  ).toBeVisible();
  await page
    .getByRole('list', { name: 'Années d’études' })
    .getByRole('link', { name: '3e année', exact: true })
    .click();
  await expect(
    page.getByRole('list', { name: 'Années d’études' }).getByRole('link', { name: '3e année' }),
  ).toHaveAttribute('aria-current', 'page');
  // Anglais starts in 4e année on the demo board.
  const subjects = page.getByRole('list', { name: 'Matières' });
  await expect(subjects.getByRole('link', { name: 'Anglais' })).toHaveCount(0);
  await subjects.getByRole('link', { name: 'Français', exact: true }).click();
  await expect(subjects.getByRole('link', { name: 'Français', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const strand = page.locator('details').filter({ hasText: /^Domaine C — / });
  await strand.locator('summary').click();
  // The innermost item: C1.2 is listed under C1.
  const c12 = strand
    .getByRole('listitem')
    .filter({ has: page.getByText('C1.2', { exact: true }) })
    .last();
  await expect(c12.getByText('À vérifier').first()).toBeVisible();
  await expect(
    c12.getByRole('link', { name: /^C1\.2, \d+ ressources? · \d+ approuvées?$/ }),
  ).toBeVisible();
  await expectAccessible(page);

  await c12.getByRole('link', { name: /^C1\.2, / }).click();
  await page.waitForURL(/\/library\?grade=3&subject=[0-9a-f-]{36}&exp=[0-9a-f-]{36}$/);
  // The results say what they are limited to, and the huard is there, approved.
  await expect(
    page.getByRole('link', { name: 'Retirer : Contenu d’apprentissage C1.2' }),
  ).toBeVisible();
  const huard = resultCard(page, HUARD);
  await expect(huard.getByRole('list', { name: 'Caractéristiques de la ressource' })).toContainText(
    'Approuvée par le conseil',
  );
  await expect(huard).toContainText('Texte de lecture');
  await expect(huard).toContainText('3e année');
  await expectAccessible(page);
});

test('searching without accents, then narrowing with the filters', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/library');
  const field = page.getByRole('searchbox', { name: 'Rechercher une ressource' });
  // A tap before the page is interactive is lost: retry until the results show.
  await expect(async () => {
    await field.fill('idee principale');
    await expect(page).toHaveURL(/q=idee\+principale/, { timeout: 2000 });
  }).toPass();
  await expect(results(page).getByRole('link', { name: HUARD })).toBeVisible();
  // The field kept its words (and its focus) as the hub turned into results.
  await expect(field).toHaveValue('idee principale');
  await expect(field).toBeFocused();
  const all = await resultCount(page);
  expect(all).toBeGreaterThan(1);

  // « Pour la suppléance », then « Approuvées par le conseil seulement ».
  await filters(page)
    .getByRole('checkbox', { name: /^Pour la suppléance/ })
    .check();
  await expect(page).toHaveURL(/sub=1/);
  expect(await resultCount(page)).toBeLessThanOrEqual(all);
  await everyCardShows(page, 'Suppléance');
  await filters(page)
    .getByRole('checkbox', { name: /^Approuvées par le conseil seulement/ })
    .check();
  await expect(page).toHaveURL(/approved=1/);
  await everyCardShows(page, 'Approuvée par le conseil');
  await expectAccessible(page);

  // « Effacer les filtres » keeps the words.
  await filters(page).getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect(page).not.toHaveURL(/sub=1|approved=1/);
  expect(await resultCount(page)).toBe(all);
  await expect(field).toHaveValue('idee principale');

  // Choosing a type still shows how many of the other types there are.
  const types = filters(page).getByRole('group', { name: 'Type' });
  await types.getByRole('checkbox', { name: /^Texte de lecture/ }).check();
  await expect(page).toHaveURL(/type=reading_passage/);
  await expect(
    results(page).getByRole('link', { name: 'Trouver l’idée principale d’un paragraphe' }),
  ).toHaveCount(0);
  await expect(
    types.getByRole('checkbox', { name: /^Plan de leçon\s*\d+ ressources?$/ }),
  ).not.toBeChecked();
  const passages = await resultCount(page);
  expect(passages).toBeLessThan(all);
  await everyCardShows(page, 'Texte de lecture', 'card');

  // The search is in the address: a reload shows the same results.
  await page.reload();
  expect(await resultCount(page)).toBe(passages);
  await expect(types.getByRole('checkbox', { name: /^Texte de lecture/ })).toBeChecked();
});

test('a result opens its page, its versions and its key; printing keeps them apart', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await page.goto('/library?q=huard');
  await results(page).getByRole('link', { name: HUARD }).click();
  await page.waitForURL(/\/library\/items\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: HUARD })).toBeVisible();
  await expectAccessible(page);

  // The version chips change the text on screen.
  const panel = page.getByRole('tabpanel');
  const base = await panel.innerText();
  const debutant = page.getByRole('button', { name: 'Débutant', exact: true });
  await expect(async () => {
    await debutant.click();
    await expect(debutant).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass();
  await expect.poll(() => panel.innerText()).not.toBe(base);
  await expect(panel).not.toContainText('Corrigé');

  // « Guide et corrigé »: the key only after « Afficher le corrigé ».
  await page.getByRole('tab', { name: 'Guide et corrigé' }).click();
  await expect(page.getByRole('heading', { name: /^Corrigé — version/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Afficher le corrigé' }).click();
  await expect(page.getByRole('heading', { name: /^Corrigé — version/ }).first()).toBeVisible();

  // Every student sheet: one per version, a small number, no level name and no key on paper.
  const itemUrl = page.url().split('?')[0]!;
  await page.goto(`${itemUrl}/print?doc=student`);
  const sheets = page.getByTestId('print-sheets');
  await expect(sheets.getByTestId('sheet-number')).toHaveText(['1', '2', '3', '4', '5']);
  await page.emulateMedia({ media: 'print' });
  const printed = page.locator('body');
  await expect(printed).not.toContainText('Débutant', { useInnerText: true });
  await expect(printed).not.toContainText('Corrigé', { useInnerText: true });
  await page.emulateMedia({ media: 'screen' });
  // The teacher document has the key.
  await page.goto(`${itemUrl}/print?doc=teacher`);
  await expect(sheets.getByRole('heading', { name: 'Corrigé — version 1' })).toBeVisible();
});
