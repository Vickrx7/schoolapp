import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDb, insertAudit, SEED } from './db';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Journal d'audit » and the direction's dashboard on a phone (DECISIONS D-102, D-103): no
 * sideways scrolling, entries as cards, the filters in a bottom sheet with 44 px controls.
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

test('the principal reads and filters the audit log on a phone', async ({ page }) => {
  await insertAudit({
    action: 'student_alert.viewed',
    boardId: SEED.board,
    schoolId: SEED.school,
    entityType: 'class',
    entityId: SEED.class3,
    details: { alert_count: 1, issued_by_role: 'office', sub_session_id: randomUUID() },
    actorType: 'substitute',
  });
  await login(page, DEMO.principal);
  await expect(page).toHaveURL(/\/direction$/);
  await tall(page.getByRole('link', { name: 'Voir le journal d’audit' }));
  await noHorizontalScroll(page);

  await page.goto('/audit');
  await expect(page.getByRole('heading', { level: 1, name: 'Journal d’audit' })).toBeVisible();
  await expect(page.getByRole('table')).toBeHidden();
  await noHorizontalScroll(page);
  await expectAccessible(page);

  // « Filtres »: a bottom sheet across the screen.
  const open = page.getByRole('button', { name: 'Filtres', exact: true });
  await tall(open);
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await open.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  const [sheet, viewport] = [await dialog.boundingBox(), page.viewportSize()];
  expect(Math.round(sheet!.x)).toBe(0);
  expect(Math.round(sheet!.width)).toBe(viewport!.width);
  await expect(dialog.getByRole('group', { name: 'Période' })).toBeVisible();
  const category = dialog.getByLabel('Catégorie');
  await tall(category);
  await expectAccessible(page);
  await category.selectOption({ label: 'Alertes' });
  await dialog.getByRole('button', { name: 'Afficher', exact: true }).click();

  await expect(page).toHaveURL(/[?&]category=alerts(&|$)/);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Filtres (1)', exact: true })).toBeVisible();
  const card = page
    .getByTestId('audit-entry')
    .filter({ hasText: 'Alertes de sécurité ou médicales consultées (1 alerte)' })
    .first();
  await expect(card).toContainText('Personne suppléante');
  await expect(card).toContainText('code émis par le secrétariat');
  await expect(card).toContainText('Code émis par le secrétariat');
  await tall(page.getByRole('link', { name: 'Télécharger (CSV)' }));
  await noHorizontalScroll(page);
  await expectAccessible(page);
});
