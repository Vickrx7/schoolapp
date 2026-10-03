import { expect, test, type Page } from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems, insertReadyItem, query, resetLanguage } from './db';
import { DEMO, chip, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Fiche de la ressource » and its print page (Phase 4, DECISIONS D-062, D-065, D-075, D-078),
 * and who reaches the « Banque de ressources » hub from the navigation. The items are written here (`insertReadyItem`), not taken from the demo pack, so the spec
 * does not depend on the seed's content: a board-approved quiz with the four board levels, a
 * colleague's private draft and one of the board's own items that is reviewed but not approved.
 */

const PREFIX = e2ePrefix();
const QUIZ = `${PREFIX} Quiz des nombres`;
const BOARD_ITEM = `${PREFIX} Jeu du conseil`;
const BANK = `${PREFIX} Commentaires de mathématiques`;
const NOT_FOUND = 'Cette page n’existe pas ou vous n’y avez pas accès.';

let quizId = '';
let draftId = '';
let boardItemId = '';
let bankId = '';
let designatedHere = false;

const mainNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Navigation principale' }).first();

test.beforeAll(async () => {
  quizId = await insertReadyItem({
    author: null,
    type: 'quiz',
    title: QUIZ,
    status: 'board_approved',
    levels: true,
    subFriendly: true,
  });
  draftId = await insertReadyItem({
    author: DEMO.teacher5,
    type: 'worksheet',
    title: `${PREFIX} Brouillon de Marc`,
  });
  boardItemId = await insertReadyItem({
    author: null,
    type: 'game',
    title: BOARD_ITEM,
    status: 'teacher_reviewed',
    scope: 'board',
  });
  bankId = await insertReadyItem({
    author: null,
    type: 'report_comments',
    title: BANK,
    status: 'board_approved',
  });
  // The demo board's reviewer (supabase/seed.sql designates her; kept if already there).
  const inserted = await query(
    `insert into public.library_reviewers (board_id, user_id, approves_content, reviews_faith)
     select $1, id, true, true from public.users where email = $2
     on conflict do nothing returning user_id`,
    [SEED.board, DEMO.boardAdmin],
  );
  designatedHere = inserted.length > 0;
});

test.afterAll(async () => {
  await deleteLibraryItems({ titlePrefix: PREFIX });
  if (designatedHere) {
    await query(
      `delete from public.library_reviewers r using public.users u
       where r.user_id = u.id and u.email = $1 and r.board_id = $2`,
      [DEMO.boardAdmin, SEED.board],
    );
  }
  await resetLanguage(DEMO.office);
  await closeDb();
});

test('the item page switches versions and keeps the key hidden until asked', async ({ page }) => {
  await login(page, DEMO.teacher3);
  // « Ressources » replaces « Différencier » in the navigation (D-078).
  await expect(mainNav(page).getByRole('link', { name: 'Ressources' })).toBeVisible();
  await expect(mainNav(page).getByRole('link', { name: 'Différencier' })).toHaveCount(0);
  // The hub links to « Texte différencié » instead, and « Ressources » stays current there.
  await page.goto('/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Banque de ressources' })).toBeVisible();
  await expect(mainNav(page).getByRole('link', { name: 'Ressources' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expectAccessible(page);
  await page.getByRole('link', { name: /^Texte différencié/ }).click();
  await page.waitForURL(/\/differentiate$/);
  await expect(mainNav(page).getByRole('link', { name: 'Ressources' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto(`/library/items/${quizId}`);
  await expect(page.getByRole('heading', { level: 1, name: QUIZ })).toBeVisible();
  const badges = page.getByRole('list', { name: 'Caractéristiques de la ressource' });
  await expect(badges).toContainText('Approuvée par le conseil');
  await expect(badges).toContainText('Suppléance');
  await expect(badges).toContainText('4 niveaux');
  // Approved items are read-only (D-063).
  await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0);

  // « Pour les élèves »: the base version, then Débutant's own version.
  await expect(page.getByRole('tab', { name: 'Pour les élèves' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { level: 2, name: QUIZ, exact: true })).toBeVisible();
  const debutant = page.getByRole('button', { name: 'Débutant', exact: true });
  // A tap before the page is interactive is lost: retry until the chip is pressed.
  await expect(async () => {
    await debutant.click();
    await expect(debutant).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass();
  await expect(panel.getByRole('heading', { level: 2, name: `${QUIZ} — version 2` })).toBeVisible();
  await expect(panel).not.toContainText('Corrigé');
  await expectAccessible(page);

  // « Guide et corrigé »: the key stays hidden until « Afficher le corrigé ».
  await page.getByRole('tab', { name: 'Guide et corrigé' }).click();
  const show = page.getByRole('button', { name: 'Afficher le corrigé' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Corrigé — version 2' })).toHaveCount(0);
  await expectAccessible(page);
  await show.click();
  await expect(page.getByRole('heading', { name: 'Corrigé — version 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Masquer le corrigé' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  // « Détails »: the attente « À vérifier » (D-030) and where the resource comes from.
  await page.getByRole('tab', { name: 'Détails' }).click();
  const details = page.getByRole('tabpanel');
  await expect(details).toContainText('B1.2');
  await expect(details).toContainText('À vérifier');
  await expect(details).toContainText('Ressource du conseil scolaire');
  await expectAccessible(page);

  // The choice is kept in the address: a reload comes back to it.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Détails' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Débutant', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a comment bank is a teacher document, never planned, presented or used by a substitute', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${bankId}`);
  await expect(page.getByRole('heading', { level: 1, name: BANK })).toBeVisible();
  // Its entries, by attente, kind and level (D-129): no student sheet, so no « Pour les élèves »;
  // its document is « Contenu », open first.
  await expect(page.getByRole('tab', { name: 'Contenu' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Pour les élèves' })).toHaveCount(0);
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: 'Attente B1.2' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Points forts' }).first()).toBeVisible();
  await expect(panel).toContainText(/Niveau 3 · Habiletés de la pensée\s:\s\{prénom\} compare/);
  // Not teaching material: no planning, class mode or projector.
  await expect(page.getByRole('button', { name: 'Ajouter à ma planification' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Présenter à la classe' })).toHaveCount(0);
  await expectAccessible(page);
  await expect(page.getByText('Banque de commentaires de bulletin').first()).toBeVisible();
  // « Détails » has no duration, materials, formats or substitute line.
  await page.getByRole('tab', { name: 'Détails' }).click();
  const details = page.getByRole('tabpanel');
  await expect(details).toContainText('B1.2');
  for (const label of ['Durée', 'Matériel', 'Formats', 'Pour la suppléance']) {
    await expect(details.getByText(label, { exact: true }), label).toHaveCount(0);
  }
  await expectAccessible(page);
});

test('printing keeps keys and level names off student sheets', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${quizId}`);
  const debutant = page.getByRole('button', { name: 'Débutant', exact: true });
  await expect(async () => {
    await debutant.click();
    await expect(debutant).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass();

  // « Imprimer » prints what is on screen: Débutant's student sheet, number 2.
  await page.getByRole('link', { name: 'Imprimer' }).click();
  await page.waitForURL(/\/print\?doc=student&v=[0-9a-f-]{36}$/);
  const sheets = page.getByTestId('print-sheets');
  await expect(sheets.getByTestId('sheet-number')).toHaveText(['2']);
  await expectAccessible(page);

  // Every version: one sheet each, numbered 1 to 5, and nothing but the sheets on paper.
  await page.goto(`/library/items/${quizId}/print?doc=student`);
  await expect(sheets.getByTestId('sheet-number')).toHaveText(['1', '2', '3', '4', '5']);
  // The legend of the numbers is on screen only.
  await expect(page.getByText('2 = Débutant', { exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const printed = page.locator('body');
  await expect(printed).not.toContainText('Débutant', { useInnerText: true });
  await expect(printed).not.toContainText('Corrigé', { useInnerText: true });
  await expect(printed).not.toContainText('Imprimer', { useInnerText: true });
  await expect(printed).toContainText(`${QUIZ} — version 5`, { useInnerText: true });
  await page.emulateMedia({ media: 'screen' });

  // The teacher document: the guide, then « Corrigé — version n » for each version.
  await expect(async () => {
    if (!/doc=teacher/.test(page.url())) await chip(page, 'Guide et corrigé').click();
    await expect(page).toHaveURL(/doc=teacher/, { timeout: 1000 });
  }).toPass();
  await expect(sheets.getByRole('heading', { name: 'Corrigé — version 1' })).toBeVisible();
  await expect(sheets.getByRole('heading', { name: 'Corrigé — version 5' })).toBeVisible();
  await expectAccessible(page);
});

test('only people who may use a resource see it, and only its keepers edit it', async ({
  page,
}) => {
  // A colleague's private draft does not exist for Isabelle.
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${draftId}`);
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  // One of the board's own items, shared and not approved: she may use it, not edit it.
  await page.goto(`/library/items/${boardItemId}`);
  await expect(page.getByRole('heading', { level: 1, name: BOARD_ITEM })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0);

  // The board's content reviewer keeps the board's own items (D-063) and sees « Ressources »
  // without a school (D-078).
  await page.context().clearCookies();
  await login(page, DEMO.boardAdmin);
  await expect(mainNav(page).getByRole('link', { name: 'Ressources' })).toBeVisible();
  // No school, so no « Texte différencié » on the hub.
  await page.goto('/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Banque de ressources' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Texte différencié/ })).toHaveCount(0);
  await page.goto(`/library/items/${boardItemId}`);
  await expect(page.getByRole('link', { name: 'Modifier' })).toBeVisible();
  // …but gets no special access to a teacher's private draft (D-065).
  await page.goto(`/library/items/${draftId}`);
  await expect(page.getByText(NOT_FOUND)).toBeVisible();

  // Office staff have no library screens, even for an approved item.
  await resetLanguage(DEMO.office);
  await page.context().clearCookies();
  await login(page, DEMO.office);
  await expect(mainNav(page).getByRole('link', { name: 'Ressources' })).toHaveCount(0);
  await page.goto('/library');
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  await page.goto(`/library/items/${quizId}`);
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
});
