import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DEMO, login, nextSchoolMonday } from './helpers';

test('the login page is accessible', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/classes');
  await expect(page).toHaveURL(/\/login\?next=%2Fclasses/);
});

test('a teacher sees the day and checks off a lesson in one tap, with undo', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/today?date=${nextSchoolMonday()}`);

  // Monday 8 h 55: Français, next lesson of the active unit is lesson 4 (3 are seeded as taught).
  const french = page
    .getByRole('listitem')
    .filter({ hasText: /Trouver l.idée principale/ })
    .first();
  await expect(french).toBeVisible();
  await expect(french).toContainText('Leçon 4');
  await expect(page.getByText('Entrée, prière du matin et O Canada')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);

  await french.getByRole('button', { name: 'Leçon donnée' }).click();
  await expect(
    page.getByText(/« Trouver l.idée principale » est marquée comme donnée\./),
  ).toBeVisible();
  await expect(french.getByRole('button', { name: 'Donnée' })).toBeVisible();

  // The second French block the same day now shows the lesson after it.
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Les détails importants' }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByText('La leçon n’est plus marquée comme donnée.')).toBeVisible();
  await expect(french.getByRole('button', { name: 'Leçon donnée' })).toBeVisible();
});

test('a teacher builds a class: students, timetable, unit and lesson, then deletes it', async ({
  page,
}) => {
  await login(page, DEMO.teacher5);
  const name = `Test e2e ${Date.now()}`;

  await page.goto('/classes');
  await page.getByRole('button', { name: 'Nouvelle classe' }).first().click();
  await page.getByLabel('Nom de la classe').fill(name);
  await page.getByLabel('6e année').check();
  await page.getByRole('button', { name: 'Créer la classe' }).click();
  await page.waitForURL(/\/classes\/[^/]+\/students/);

  // Students: paste a list; a full name and a duplicate are flagged.
  await page.getByRole('button', { name: 'Ajouter des élèves' }).click();
  await page.getByLabel('Prénoms (un par ligne)').fill('Léa\nNathan\nMarie Tremblay\nléa');
  await expect(page.getByText('ressemble à un nom complet')).toBeVisible();
  await expect(page.getByText('déjà dans la liste')).toBeVisible();
  await page.getByRole('button', { name: /Ajouter 4 élèves/ }).click();
  await expect(page.getByText('4 élèves ajoutés.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prénom ou surnom' })).toHaveCount(4);

  // Timetable: one math block on Monday and Wednesday.
  await page.getByRole('link', { name: 'Horaire' }).click();
  await page.getByRole('button', { name: 'Ajouter une période' }).first().click();
  for (const day of ['mardi', 'jeudi', 'vendredi']) await page.getByLabel(day).uncheck();
  await page.getByLabel('Début').fill('09:00');
  await page.getByLabel('Fin').fill('09:50');
  await page.getByLabel('Matière', { exact: true }).selectOption({ label: 'Mathématiques' });
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Horaire mis à jour.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Mathématiques/ })).toHaveCount(2);

  // Planning: an active unit with one lesson.
  await page.getByRole('link', { name: 'Planification' }).click();
  await page.getByRole('button', { name: 'Nouvelle unité' }).first().click();
  await page.getByLabel('Matière').selectOption({ label: 'Mathématiques' });
  await page.getByLabel('Titre de l’unité').fill('Les nombres décimaux');
  await page.getByRole('button', { name: 'Créer l’unité' }).click();
  await page.waitForURL(/\/planning\/[^/]+$/);
  await page.getByRole('button', { name: 'Ajouter une leçon' }).click();
  await page.getByLabel('Titre de la leçon').fill('Les dixièmes');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Leçon enregistrée.')).toBeVisible();
  await expect(page.getByText('Les dixièmes')).toBeVisible();

  // Delete the class (typing its name to confirm).
  await page.getByRole('link', { name: 'Paramètres' }).click();
  await page.getByLabel('Nom de la classe').last().fill(name);
  await page.getByRole('button', { name: 'Supprimer la classe' }).click();
  await page.waitForURL(/\/classes$/);
  await expect(page.getByText(name)).toHaveCount(0);
});

test('CSV import sends first names only', async ({ page }) => {
  await login(page, DEMO.teacher5);
  await page.goto('/classes');
  await page.getByRole('link', { name: /5e année – M\. Gagnon/ }).click();
  await page.getByRole('button', { name: 'Ajouter des élèves' }).click();
  await page.getByRole('tab', { name: 'Importer un fichier CSV' }).click();

  const csv =
    'NISO;Nom;Prénom;Date de naissance\n123456789;Tremblay;Rosalie;2016-04-02\n987654321;Roy;Émile;2016-01-15\n';
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posted.push(r.postData() ?? '');
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'classe.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'latin1'),
  });

  await expect(page.getByLabel('Colonne des prénoms')).toHaveValue('2');
  await expect(page.getByText(/Colonnes ignorées/)).toContainText('NISO');
  await expect(page.getByRole('option', { name: /Nom \(donnée sensible\)/ })).toBeDisabled();
  await page.getByRole('button', { name: /Ajouter 2 élèves/ }).click();
  await expect(page.getByText('2 élèves ajoutés.')).toBeVisible();

  const body = posted.join('\n');
  expect(body).toContain('Rosalie');
  expect(body).toContain('Émile');
  expect(body).not.toMatch(/Tremblay|Roy|123456789|2016-04-02/);

  // Clean up the two students.
  for (const first of ['Rosalie', 'Émile']) {
    const row = page.getByRole('listitem').filter({ has: page.locator(`input[value="${first}"]`) });
    await row.getByRole('button', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.locator(`input[value="${first}"]`)).toHaveCount(0);
  }
});

test('alerts stay hidden until revealed, and can be added and removed', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/classes');
  await page.getByRole('link', { name: /3e année – Mme Tremblay/ }).click();
  await expect(page.getByText('Allergie sévère')).toHaveCount(0);

  await page.getByRole('button', { name: 'Alerte de sécurité ou médicale' }).click();
  const row = page.getByRole('listitem').filter({ has: page.locator('input[value="Léa"]') });
  await row.getByRole('button', { name: 'Ajouter une alerte' }).click();
  await row.getByLabel('Description').fill('Allergie sévère aux arachides, épipen dans le sac');
  await row.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Alerte enregistrée.')).toBeVisible();
  await expect(row.getByText('Allergie sévère aux arachides, épipen dans le sac')).toBeVisible();

  await row.getByRole('button', { name: 'Supprimer' }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText('Alerte supprimée.')).toBeVisible();
});

test('a rotary teacher sees only their own blocks in other classes', async ({ page }) => {
  await login(page, DEMO.rotary);
  await page.goto(`/today?date=${nextSchoolMonday()}`);
  await expect(page.getByRole('heading', { name: 'Anglais' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mathématiques' })).toHaveCount(0);
});

test('the principal manages the school calendar but has no teaching screens', async ({ page }) => {
  await login(page, DEMO.principal);
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByText('Journée pédagogique').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Classes' })).toHaveCount(0);
  await page.goto('/school');
  await expect(page.getByRole('heading', { name: 'Paramètres de l’école' })).toBeVisible();
});
