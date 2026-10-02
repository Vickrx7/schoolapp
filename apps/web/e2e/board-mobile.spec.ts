import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDb, query, SEED } from './db';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Conseil » on a phone (DECISIONS D-107): every page fits a Pixel 7 without sideways scrolling,
 * passes axe, and its tabs and main buttons are 44 px targets; the invitation form and the
 * « Périodes de bulletin » editor (D-124, at 360 px) are bottom sheets; the staff list and the
 * usage table are cards.
 */

test.afterAll(async () => {
  await closeDb();
});

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function tall(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test('a board admin runs the board from a phone', async ({ page }) => {
  test.setTimeout(120_000);
  const message = `Commentaire sur téléphone ${e2ePrefix()} avec un très long mot ${'x'.repeat(80)}`;
  await query(
    `insert into public.feedback (board_id, user_id, kind, message, device, locale)
     select $1, u.id, 'problem', $2, 'phone', 'fr-CA' from public.users u where u.email = $3`,
    [SEED.board, message, DEMO.teacher5],
  );
  try {
    await login(page, DEMO.boardAdmin);
    await expect(page).toHaveURL(/\/board$/);
    const tabs = page.getByRole('navigation', { name: 'Sections de l’administration du conseil' });
    await tall(tabs.getByRole('link', { name: 'Aperçu' }));
    await tall(page.getByRole('link', { name: /Personnel invité/ }));
    await noHorizontalScroll(page);
    await expectAccessible(page);

    // « Personnel »: cards, and « Inviter une personne » as a bottom sheet.
    await tabs.getByRole('link', { name: 'Personnel', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Personnel' })).toBeVisible();
    await expect(page.getByRole('table')).toBeHidden();
    await tall(page.getByRole('link', { name: 'Isabelle Tremblay' }));
    await noHorizontalScroll(page);
    await expectAccessible(page);
    const dialog = page.getByRole('dialog');
    const open = page.getByRole('button', { name: 'Inviter une personne' });
    await tall(open);
    await expect(async () => {
      if (!(await dialog.isVisible())) await open.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    const [sheet, viewport] = [await dialog.boundingBox(), page.viewportSize()];
    expect(Math.round(sheet!.x)).toBe(0);
    expect(Math.round(sheet!.width)).toBe(viewport!.width);
    await tall(dialog.getByLabel('Courriel', { exact: true }));
    await expectAccessible(page);
    await page.keyboard.press('Escape');

    // A person's page.
    await page.getByRole('link', { name: 'Julie Bergeron' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Julie Bergeron' })).toBeVisible();
    await tall(page.getByRole('button', { name: 'Retirer l’accès' }));
    await noHorizontalScroll(page);
    await expectAccessible(page);

    // « Périodes de bulletin » (D-124) on a 360 px phone: a bottom sheet of 44 px fields.
    const phoneSize = page.viewportSize()!;
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/board/years');
    await expect(page.getByRole('heading', { level: 1, name: 'Années scolaires' })).toBeVisible();
    await noHorizontalScroll(page);
    const periods = page.getByRole('dialog', { name: 'Périodes de bulletin — 2026-2027' });
    const openPeriods = page.getByRole('button', {
      name: 'Périodes de bulletin de l’année 2026-2027',
    });
    await tall(openPeriods);
    await expect(async () => {
      if (!(await periods.isVisible())) await openPeriods.click();
      await expect(periods).toBeVisible({ timeout: 1000 });
    }).toPass();
    const periodsSheet = await periods.boundingBox();
    expect(Math.round(periodsSheet!.x)).toBe(0);
    expect(Math.round(periodsSheet!.width)).toBe(360);
    await tall(periods.getByRole('button', { name: 'Préremplir avec les dates habituelles' }));
    const progress = periods.getByRole('group', { name: 'Bulletin de progrès', exact: true });
    await tall(progress.getByLabel('Début de la période d’évaluation'));
    await tall(progress.getByLabel('Remise aux familles (facultatif)'));
    await noHorizontalScroll(page);
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(periods).toBeHidden();
    await page.setViewportSize(phoneSize);

    for (const [path, heading] of [
      ['/board/schools', 'Écoles'],
      [`/board/schools/${SEED.school}`, 'École élémentaire catholique Saint-Exemple'],
      ['/board/years', 'Années scolaires'],
      ['/board/reviewers', 'Approbation des ressources'],
      ['/board/usage', 'Utilisation de l’IA'],
      ['/audit', 'Journal d’audit'],
      ['/board/feedback', 'Commentaires reçus'],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await noHorizontalScroll(page);
      await expectAccessible(page);
    }
    // The feedback, long words included, wraps inside the screen.
    await expect(page.getByText(message)).toBeVisible();
    // The current section is scrolled into view, and the row says more sections are to the left.
    const current = tabs.locator('[aria-current="page"]');
    await expect(current).toHaveText('Commentaires');
    await expect(async () => {
      const box = await current.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }).toPass();
    await expect(page.getByTestId('board-tabs-more-before')).toBeVisible();
    await tall(page.getByRole('button', { name: 'Marquer comme lu' }).first());
  } finally {
    await query('delete from public.feedback where message = $1', [message]);
  }
});
