import { expect, test, type Page } from '@playwright/test';
import { closeDb, deleteLibraryItems, insertReadyItem } from './db';
import { coverageGap, subjectId } from './db-coverage';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Couverture du curriculum » (Phase 5, DECISIONS D-094), read-only on the demo resources of
 * the seed: from the hub to 3e année, Mathématiques; the overview of grades and subjects; an
 * attente without approved resources and its « Créer une ressource »; « Comment on compte »; the
 * filter « Sans ressource approuvée ». A board draft on B1.2 (made here, deleted afterwards) is
 * « en révision » for the board's content reviewer only. Other specs may leave resources of their
 * own around, so the attente without resources is looked up, never fixed.
 */

const PREFIX = e2ePrefix('coverage');
/** The level badges of attentes that have approved resources (« Peu : 1 … », « 3 … »). */
const WITH_APPROVED = /^(Peu\s: )?\d+ ressources? approuvées?$/;

const overview = (page: Page) =>
  page.getByRole('region', { name: /^Attentes qui ont au moins une ressource approuvée/ });
/** An attente of the list by its code (the innermost item: B1.2 is listed under B1). */
const attente = (page: Page, code: string) =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByText(code, { exact: true }) })
    .last();

test.beforeAll(async () => {
  // insertReadyItem links 3e année Mathématiques B1.2; a draft of the board's own is in review.
  await insertReadyItem({
    author: null,
    type: 'worksheet',
    title: `${PREFIX} Brouillon du conseil`,
  });
});

test.afterAll(async () => {
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await closeDb();
});

test('a teacher finds the attentes without approved resources', async ({ page }) => {
  test.setTimeout(90_000);
  const gap = await coverageGap('3', 'mat');
  await login(page, DEMO.teacher3);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Couverture du curriculum', exact: true }).click();
  // Opened on her grade.
  await page.waitForURL(/\/library\/coverage\?grade=3$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Couverture du curriculum' }),
  ).toBeVisible();

  // « Vue d’ensemble »: grades × subjects.
  await expect(page.getByRole('heading', { level: 2, name: 'Vue d’ensemble' })).toBeVisible();
  await expect(overview(page).getByRole('columnheader', { name: 'Mathématiques' })).toBeVisible();
  await expect(overview(page).getByRole('rowheader', { name: '3e année' })).toBeVisible();
  await expectAccessible(page);

  await page
    .getByRole('list', { name: 'Matières' })
    .getByRole('link', { name: 'Mathématiques', exact: true })
    .click();
  await page.waitForURL(/\/library\/coverage\?grade=3&subject=[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Mathématiques · 3e année' }),
  ).toBeVisible();
  await expect(
    page.getByText(/^\d+ attentes? sur \d+ (a|ont) au moins une ressource approuvée\.$/),
  ).toBeVisible();
  // The overview marks the grade and subject shown.
  await expect(
    overview(page).getByRole('link', { name: /^Mathématiques, 3e année\s:/ }),
  ).toHaveAttribute('aria-current', 'page');

  // An attente without approved resources, and what to do about it.
  const missing = attente(page, gap.code);
  await expect(missing.getByText('Aucune ressource approuvée', { exact: true })).toBeVisible();
  await expect(
    missing.getByRole('link', { name: `Créer une ressource (${gap.code})` }),
  ).toHaveAttribute('href', /^\/library\/new\?grade=3&subject=[0-9a-f-]{36}&exp=[0-9a-f-]{36}$/);
  // « En révision » is for the board's content reviewers only.
  await expect(attente(page, 'B1.2').getByText(/en révision$/)).toHaveCount(0);
  await expectAccessible(page);

  // « Comment on compte » says why the numbers differ from browsing.
  await page.getByText('Comment on compte', { exact: true }).click();
  await expect(
    page.getByText(/^Seules les ressources approuvées par le conseil comptent/),
  ).toBeVisible();
  await expect(
    page.getByText(/^«\sParcourir le curriculum\s» peut donner un nombre/),
  ).toBeVisible();

  // « Sans ressource approuvée » narrows the list to the attentes without any.
  const withApproved = page.getByRole('main').getByRole('listitem').getByText(WITH_APPROVED);
  expect(await withApproved.count()).toBeGreaterThan(0);
  await page
    .getByRole('list', { name: 'Afficher' })
    .getByRole('link', { name: 'Sans ressource approuvée' })
    .click();
  await expect(page).toHaveURL(/show=none/);
  await expect(withApproved).toHaveCount(0);
  await expect(attente(page, gap.code)).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Afficher' })
      .getByRole('link', { name: 'Sans ressource approuvée' }),
  ).toHaveAttribute('aria-current', 'true');
  await expectAccessible(page);

  // « Seuil » 3: the threshold is in the address too; « Toutes » lists everything again.
  await page
    .getByRole('list', { name: 'Seuil' })
    .getByRole('link', { name: '3', exact: true })
    .click();
  await expect(page).toHaveURL(/show=none&min=3/);
  await page.getByRole('list', { name: 'Afficher' }).getByRole('link', { name: 'Toutes' }).click();
  await expect(page).toHaveURL(/\/library\/coverage\?grade=3&subject=[0-9a-f-]{36}&min=3$/);
  await expect(withApproved.first()).toBeVisible();
});

test('the board’s content reviewer also sees what is in review', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, DEMO.boardAdmin);
  await page.goto(`/library/coverage?grade=3&subject=${await subjectId('mat')}`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Mathématiques · 3e année' }),
  ).toBeVisible();
  // The board draft made for this spec (at least: other specs may leave drafts on B1.2).
  await expect(attente(page, 'B1.2').getByText(/^\d+ en révision$/)).toBeVisible();
  // She works at no school, so she is offered no « Créer une ressource ».
  await expect(page.getByRole('link', { name: /^Créer une ressource/ })).toHaveCount(0);
  await page.getByText('Comment on compte', { exact: true }).click();
  await expect(page.getByText(/^«\sEn révision\s» compte/)).toBeVisible();
  await expectAccessible(page);
});
