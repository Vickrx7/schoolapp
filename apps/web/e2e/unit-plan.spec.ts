import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb } from './db';
import { UNITS, restoreUnitPlan, unitPlan, type UnitPlanRow } from './db-year-plan';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Mon année », slice S1 (DECISIONS D-123): on a unit's page, the teacher sees its planned weeks
 * and the attentes it aims at, and changes them in « Planification de l'unité »: the first and
 * last week (with the weeks and school days they hold), an overall attente ticked for all its
 * contenus, the filter. The lesson form then lists « Attentes de l'unité » first. The unit's
 * planning is put back at the end.
 */

let seeded: UnitPlanRow;

test.beforeAll(async () => {
  seeded = await unitPlan(UNITS.fra3);
  // A known starting point: six weeks in the fall, four attentes.
  await restoreUnitPlan(UNITS.fra3, {
    ...seeded,
    planned_start_on: '2026-09-14',
    planned_end_on: '2026-10-23',
    codes: ['C1.1', 'C1.2', 'C1.3', 'D1.1'],
  });
});

test.afterAll(async () => {
  await restoreUnitPlan(UNITS.fra3, seeded);
  await closeDb();
});

/** Opens a dialog from its button, retrying a tap made before the page was interactive. */
async function openDialog(page: Page, button: Locator, dialog: Locator) {
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
}

const chips = (page: Page) =>
  page.getByRole('list', { name: 'Attentes visées' }).getByRole('listitem');

test('a teacher plans a unit’s weeks and attentes on its page', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, DEMO.teacher3);
  await page.goto(`/classes/${SEED.class3}/planning/${UNITS.fra3}`);
  await expect(page.getByRole('heading', { name: 'Planification de l’unité' })).toBeVisible();
  await expect(
    page.getByText(/^Prévue du 14 septembre au 23 octobre\s·\s6 semaines\s·\s28 jours de classe$/),
  ).toBeVisible();
  await expect(chips(page)).toHaveText(['C1.1', 'C1.2', 'C1.3', 'D1.1']);
  await expectAccessible(page);

  const dialog = page.getByRole('dialog', { name: 'Planification de l’unité' });
  await openDialog(page, page.getByRole('button', { name: 'Modifier la planification' }), dialog);
  await expect(dialog.getByLabel('Titre de l’unité')).toHaveValue(
    "Lire pour s'informer : les animaux de l'Ontario",
  );
  await expect(dialog.getByLabel('Première semaine')).toHaveValue('2026-09-14');
  await expect(dialog.getByLabel('Dernière semaine')).toHaveValue('2026-10-19');
  // The weeks say how many school days they hold: Thanksgiving week has four.
  await expect(
    dialog.getByLabel('Dernière semaine').locator('option[value="2026-10-12"]'),
  ).toHaveText('Semaine du 12 octobre (4 jours de classe)');
  await expect(
    dialog.getByLabel('Dernière semaine').locator('option[value="2026-12-21"]'),
  ).toHaveText('Semaine du 21 décembre (pas d’école)');
  await dialog.getByLabel('Dernière semaine').selectOption('2026-11-02');
  await expect(dialog.getByText(/^8 semaines\s·\s38 jours de classe$/)).toBeVisible();

  // The attentes: summaries to be checked, by domaine.
  await expect(
    dialog.getByText('Attentes résumées, à vérifier contre le programme officiel', {
      exact: false,
    }),
  ).toBeVisible();
  const box = (code: string) =>
    dialog.getByRole('checkbox', { name: new RegExp(`^${code.replace('.', '\\.')}\\s`) });
  await expect(box('C1.2')).toBeChecked();
  // C1 has three of its four contenus: partly ticked.
  await expect(box('C1')).not.toBeChecked();
  await expect(box('C1')).toHaveJSProperty('indeterminate', true);
  // Ticking an overall attente chooses all its contenus.
  await box('D1').check();
  for (const code of ['D1', 'D1.1', 'D1.2', 'D1.3']) await expect(box(code)).toBeChecked();
  await expect(box('D1')).toHaveJSProperty('indeterminate', false);
  await box('C1.3').uncheck();
  await expect(dialog.getByText('6 attentes choisies')).toBeVisible();
  // The filter keeps the domaine's overall attente above what it finds.
  await dialog.getByLabel('Filtrer les attentes').fill('idee principale');
  await expect(box('C1.2')).toBeVisible();
  await expect(box('C1')).toBeVisible();
  await expect(box('D1.2')).toHaveCount(0);
  await expectAccessible(page);
  await dialog.getByLabel('Filtrer les attentes').fill('');

  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Planification enregistrée.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(/^Prévue du 14 septembre au 6 novembre\s·\s8 semaines\s·\s38 jours de classe$/),
  ).toBeVisible();
  await expect(chips(page)).toHaveText(['C1.1', 'C1.2', 'D1', 'D1.1', 'D1.2', 'D1.3']);
  expect(await unitPlan(UNITS.fra3)).toMatchObject({
    planned_start_on: '2026-09-14',
    planned_end_on: '2026-11-06',
    codes: ['C1.1', 'C1.2', 'D1', 'D1.1', 'D1.2', 'D1.3'],
  });
  await page.getByRole('main').getByText('Voir le texte des attentes').click();
  await expect(page.getByText(/^D1\.2 Trouver et développer des idées/)).toBeVisible();
  await expectAccessible(page);

  // The lesson form lists the unit's attentes first.
  const lessonDialog = page.getByRole('dialog', { name: 'Ajouter une leçon' });
  await openDialog(
    page,
    page.getByRole('button', { name: 'Ajouter une leçon' }).first(),
    lessonDialog,
  );
  const lessonBoxes = lessonDialog.getByRole('checkbox');
  await expect(lessonDialog.getByText('Attentes de l’unité', { exact: true })).toBeVisible();
  await expect(lessonDialog.getByText('Autres attentes', { exact: true })).toBeVisible();
  await expect(lessonBoxes.first()).toHaveAccessibleName(/^C1\.1\s/);
  await expect(lessonBoxes.nth(5)).toHaveAccessibleName(/^D1\.3\s/);
  await expectAccessible(page);
  await page.keyboard.press('Escape');
});
