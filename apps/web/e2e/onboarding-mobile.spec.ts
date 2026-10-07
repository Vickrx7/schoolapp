import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDb, createStaffUser, deleteSampleClasses, deleteStaff } from './db';
import { acceptWelcome, expectAccessible, login, nextSchoolMonday } from './helpers';

/**
 * A teacher's first sign-in on a phone (DECISIONS D-109): « Bienvenue », « Pour bien commencer »
 * and the sample class, with no sideways scrolling and targets of at least 44 px.
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

test('a new teacher starts on a phone', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `onboarding-phone-${Date.now().toString(36)}@demo.lynx.test`;
  await createStaffUser({ email, name: 'Chantal Mobile', role: 'teacher', honorific: 'Mme' });
  try {
    await login(page, email);
    await expect(page).toHaveURL(/\/bienvenue/);
    await expect(page.getByRole('heading', { level: 1, name: 'Bienvenue' })).toBeVisible();
    await tall(page.getByRole('checkbox', { name: /^J’ai lu et j’accepte/ }).locator('..'));
    await tall(page.getByLabel(/^Comment les élèves vous appellent-ils/));
    await tall(page.getByRole('button', { name: 'Commencer', exact: true }));
    await noHorizontalScroll(page);
    await expectAccessible(page);
    await acceptWelcome(page);
    await expect(page).toHaveURL(/\/today$/);

    // « Pour bien commencer » on « Aujourd'hui »: every step a 44 px target.
    const checklist = page.getByTestId('onboarding-checklist');
    await expect(checklist).toContainText('0 sur 4');
    for (const step of [
      'Créer votre classe',
      'Ajouter vos élèves (prénoms seulement)',
      'Entrer votre horaire',
      'Créer une unité et ses leçons',
    ]) {
      await tall(checklist.getByRole('link', { name: step }));
    }
    await tall(checklist.getByRole('button', { name: 'Masquer', exact: true }));
    const sample = checklist.getByRole('button', { name: 'Essayer avec une classe exemple (3e)' });
    await tall(sample);
    await noHorizontalScroll(page);
    await expectAccessible(page);

    await sample.click();
    await expect(page.getByText('Classe exemple créée.')).toBeVisible();
    await tall(
      page.getByRole('link', { name: 'Votre classe exemple : Classe exemple (3e année)' }),
    );
    await noHorizontalScroll(page);

    await page.goto(`/today?date=${nextSchoolMonday()}`);
    await expect(page.getByTestId('sample-badge').first()).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto('/absences/new');
    await expect(
      page.getByText('Votre classe exemple n’est pas incluse dans les plans de suppléance.'),
    ).toBeVisible();
    await noHorizontalScroll(page);

    // The class page: the notice, and « Supprimer la classe exemple » in reach.
    await page.goto('/classes');
    await page.getByRole('link').filter({ hasText: 'Classe exemple (3e année)' }).click();
    await expect(page.getByTestId('sample-notice')).toBeVisible();
    const remove = page.getByRole('button', { name: 'Supprimer la classe exemple' });
    await tall(remove);
    await noHorizontalScroll(page);
    await expectAccessible(page);
    const dialog = page.getByRole('dialog');
    await expect(async () => {
      if (!(await dialog.isVisible())) await remove.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByRole('button', { name: 'Supprimer la classe exemple', exact: true }).click();
    await expect(page).toHaveURL(/\/demarrage$/);
    await expect(page.getByTestId('onboarding-checklist')).toContainText('0 sur 4');
    await noHorizontalScroll(page);
  } finally {
    await deleteSampleClasses(email);
    await deleteStaff(email);
  }
});
