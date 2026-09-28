import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, login } from './helpers';

// Needs the worker running with AI_PROVIDER=fake (as in CI): nothing leaves the machine.

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
}

const TEXT =
  'Zoé observe un castor près de la rivière. Le castor construit un barrage avec des branches. ' +
  'Il vit en famille dans une hutte.';

test('the principal turns AI on, then a teacher differentiates a text without names leaving', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);

  // AI is off until the direction turns it on.
  await login(page, DEMO.principal);
  await page.goto('/school');
  const enable = page.getByRole('button', { name: 'Activer l’IA' });
  if (await enable.isVisible()) {
    const dialog = page.getByRole('dialog');
    // A click before the page is interactive is lost: retry until the dialog opens.
    await expect(async () => {
      if (!(await dialog.isVisible())) await enable.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByRole('button', { name: 'Activer l’IA' }).click();
  }
  await expect(page.getByText('L’IA est activée.')).toBeVisible();
  await expect(page.getByText('Utilisation ce mois-ci')).toBeVisible();
  await context.clearCookies();

  await login(page, DEMO.teacher3);
  await page.goto('/differentiate');
  await expect(page.getByRole('heading', { name: 'Texte différencié' })).toBeVisible();
  await expectAccessible(page);

  // A personal detail blocks the request before anything is sent.
  await page.getByLabel('Titre').fill('Le castor');
  await page
    .getByLabel('Texte, consignes ou activité')
    .fill(`${TEXT} Écrivez-moi à parent.zoe@example.com.`);
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(page.getByText('Renseignements personnels à retirer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Envoyer à l’IA' })).toBeDisabled();

  // Without it, the preview shows the student's name replaced.
  await page.getByRole('button', { name: 'Modifier le texte' }).click();
  await page.getByLabel('Texte, consignes ou activité').fill(TEXT);
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(page.locator('mark', { hasText: 'Élève A' })).toBeVisible();
  await expect(page.getByText('1 nom remplacé.')).toBeVisible();
  await page.getByRole('button', { name: 'Envoyer à l’IA' }).click();

  // The worker answers; names come back only on our side.
  await page.waitForURL(/\/differentiate\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Débutant' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Enrichi' })).toBeVisible();
  await expect(page.getByLabel('Texte', { exact: true }).last()).toHaveValue(
    /Zoé observe un castor/,
  );
  await page.getByText('Voir exactement ce qui a été envoyé').click();
  const sent = page.locator('details pre');
  await expect(sent).toContainText('Élève A observe un castor');
  await expect(sent).not.toContainText('Zoé');
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForURL(/\/differentiate\/saved\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Titre', { exact: true }).first()).toHaveValue('Le castor');

  await page.goto('/differentiate');
  await expect(page.getByRole('link', { name: 'Le castor' }).first()).toBeVisible();
});

test('a teacher adds a language level of their own', async ({ page }) => {
  await login(page, DEMO.teacher5);
  await page.goto('/differentiate/levels');
  const name = `Accueil ${Date.now().toString().slice(-5)}`;
  await page.getByLabel('Nom du niveau').last().fill(name);
  await page.getByLabel('Description pour l’IA').last().fill('Mots très simples et images.');
  await page.getByRole('button', { name: 'Ajouter un niveau' }).click();
  await expect(page.getByText('Niveau ajouté.')).toBeVisible();
  await page.goto('/differentiate');
  await expect(page.getByText(name)).toBeVisible();
});
