import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDb, deleteLibraryItems, insertReadyItem } from './db';
import {
  DEMO_ITEMS,
  DEMO_PACK_TITLE,
  clearOpinion,
  deleteAdaptations,
  opinionCount,
  visibleOpinionCount,
} from './db-library-growth';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * Library growth (Phase 5, DECISIONS D-092, D-093): « Adapter cette ressource » makes a private
 * copy that opens in the editor with its credit line and shows as « Adaptation » in « Mes
 * ressources »; « Votre avis » gives anonymous stars on a board-approved resource, with « N avis :
 * pas encore assez pour une moyenne » below 5 of her colleagues' opinions (never her own); an
 * author gets no stars on her own
 * resource; result cards show opinions and usage. On the demo resources of the seed; the
 * adaptations, opinions and « E2E-… » resources made here are deleted afterwards.
 */

const PREFIX = e2ePrefix('growth');
const { huard } = DEMO_ITEMS;

test.beforeAll(async () => {
  await clearOpinion(huard.id, DEMO.teacher3);
});

test.afterAll(async () => {
  await deleteAdaptations(huard.id, DEMO.teacher5);
  await clearOpinion(huard.id, DEMO.teacher3);
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await closeDb();
});

/** A click before the page is interactive is lost: retry until the dialog opens. */
async function openDialog(page: Page, trigger: Locator) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

/** What the opinion line says for a number of opinions (the average's value is not checked). */
function opinionLine(count: number): RegExp {
  if (count === 0) return /^Aucun avis pour l’instant$/;
  if (count < 5) return new RegExp(`^${count} avis : pas encore assez pour une moyenne$`);
  return new RegExp(`sur 5 \\(${count} avis\\)$`);
}

test('a teacher adapts a board resource: a private copy, credited, in the editor', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const title = `${PREFIX} Le huard de ma classe`;
  await login(page, DEMO.teacher5);
  await page.goto(`/library/items/${huard.id}`);
  await expect(page.getByRole('heading', { level: 1, name: huard.title })).toBeVisible();

  const dialog = await openDialog(
    page,
    page.getByRole('button', { name: 'Adapter cette ressource' }),
  );
  await expect(dialog.getByText(/Une copie privée s’ouvrira dans l’éditeur/)).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Créer mon adaptation' }).click();

  // The copy opens in the editor, credited to the original (read live: the demo pack's).
  await page.waitForURL(/\/library\/items\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByText(/^Adaptation créée : modifiez-la à votre goût/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: `Adaptée de « ${huard.title} »`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(`(ensemble « ${DEMO_PACK_TITLE} »)`, { exact: true })).toBeVisible();
  const copyId = /\/library\/items\/([0-9a-f-]{36})\/edit$/.exec(page.url())![1]!;
  expect(copyId).not.toBe(huard.id);

  await page.getByLabel('Titre', { exact: true }).fill(title);
  await page
    .getByTestId('library-save-bar')
    .getByRole('button', { name: 'Enregistrer', exact: true })
    .click();
  await expect(page.getByTestId('library-save-bar')).toContainText('Enregistré à');

  // Its page: a private draft, with the credit line linking to the original.
  await page.goto(`/library/items/${copyId}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(
    page.getByRole('link', { name: `Adaptée de « ${huard.title} »`, exact: true }),
  ).toHaveAttribute('href', `/library/items/${huard.id}`);
  // A draft takes no opinion.
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
  await expectAccessible(page);

  // « Mes ressources »: the draft is marked « Adaptation ».
  await page.goto('/library/mine?tab=drafts');
  const row = page
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });
  await expect(row.getByText('Adaptation', { exact: true })).toBeVisible();
});

test('a teacher gives her opinion on a board-approved resource, then takes it back', async ({
  page,
}) => {
  const all = await opinionCount(huard.id);
  const others = await visibleOpinionCount(huard.id, DEMO.teacher3);
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${huard.id}`);
  const section = page.getByRole('region', { name: 'Votre avis' });
  await expect(section.getByText(opinionLine(others))).toBeVisible();
  await expect(section.getByText(/jamais le vôtre\.$/)).toBeVisible();
  await expectAccessible(page);

  const four = section.getByRole('radio', { name: '4 étoiles sur 5' });
  await expect(async () => {
    await four.check();
    await expect(four).toBeChecked({ timeout: 1000 });
  }).toPass();
  await expect(section.getByText('Votre avis est enregistré.')).toBeVisible();
  expect(await opinionCount(huard.id)).toBe(all + 1);
  // Her own opinion never counts in what she sees (changing it tells her nothing, D-093).
  await expect(section.getByText(opinionLine(others))).toBeVisible();

  // It is kept: after a reload, her four stars are still chosen.
  await page.reload();
  await expect(section.getByRole('radio', { name: '4 étoiles sur 5' })).toBeChecked();
  await expect(section.getByRole('radio', { name: '5 étoiles sur 5' })).not.toBeChecked();
  await expectAccessible(page);

  await section.getByRole('button', { name: 'Retirer mon avis' }).click();
  await expect(section.getByText('Votre avis est retiré.')).toBeVisible();
  await expect(section.getByText(opinionLine(others))).toBeVisible();
  expect(await opinionCount(huard.id)).toBe(all);
});

test('an author gets no stars on her own resource; cards show opinions and usage', async ({
  page,
}) => {
  const ownTitle = `${PREFIX} Ma fiche approuvée`;
  const own = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'worksheet',
    title: ownTitle,
    status: 'board_approved',
    levels: true,
  });
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${own}`);
  await expect(page.getByRole('heading', { level: 1, name: ownTitle })).toBeVisible();
  const section = page.getByRole('region', { name: 'Avis des collègues' });
  await expect(section.getByText(opinionLine(0))).toBeVisible();
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
  // An approved resource is read-only, even for its author: she adapts it to change it.
  await expect(page.getByRole('button', { name: 'Adapter cette ressource' })).toBeVisible();

  await page.goto('/library?q=huard');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: huard.title, exact: true }) });
  // The seed gives it two opinions; a card shows no line without any.
  const opinions = await opinionCount(huard.id);
  if (opinions > 0) await expect(card.getByText(opinionLine(opinions))).toBeVisible();
  await expect(
    card.getByText(/^(Utilisée dans \d+ unités?|Pas encore utilisée dans une unité)$/),
  ).toBeVisible();
  await expectAccessible(page);
});
