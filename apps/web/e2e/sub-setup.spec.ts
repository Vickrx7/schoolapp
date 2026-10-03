import { expect, test } from '@playwright/test';
import { SEED, closeDb, query } from './db';
import { DEMO, expectAccessible, login } from './helpers';

// What is set up before any absence (DECISIONS D-057): the class's « Fiche de suppléance » and
// the direction's « Suppléance » card on the École page; and the teacher's « Mes absences ».
// Each page is checked with axe.

test.afterAll(async () => {
  await closeDb();
});

test('the class team keeps the « Fiche de suppléance » up to date', async ({ page }) => {
  const [before] = await query<{ routines_notes: string | null }>(
    'select routines_notes from public.class_sub_profiles where class_id = $1',
    [SEED.class3],
  );
  const routines = `Rang près de la porte à la cloche (${Date.now()}).`;
  try {
    await login(page, DEMO.teacher3);
    await page.goto(`/classes/${SEED.class3}/substitute`);
    await expect(page.getByRole('heading', { name: 'Fiche de suppléance' })).toBeVisible();
    await expect(page.getByText('N’y écrivez aucun renseignement médical')).toBeVisible();
    await expectAccessible(page);

    const field = page.getByLabel(/^Routines/);
    // A change before the page is interactive is lost: retry until it holds.
    await expect(async () => {
      await field.fill(routines);
      await expect(field).toHaveValue(routines, { timeout: 1000 });
    }).toPass();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Fiche enregistrée.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/^Routines/)).toHaveValue(routines);
  } finally {
    await query('update public.class_sub_profiles set routines_notes = $2 where class_id = $1', [
      SEED.class3,
      before?.routines_notes ?? null,
    ]);
  }
});

test('the direction finds the substitute settings and the board on the École page', async ({
  page,
}) => {
  await login(page, DEMO.principal);
  await page.goto('/school');
  await expect(page.getByRole('heading', { name: /^Suppléance · / })).toBeVisible();
  await expect(page.getByLabel('Code valide à partir de')).toHaveValue('05:00');
  await expect(page.getByLabel('Code valide jusqu’à')).toHaveValue('18:00');
  await expectAccessible(page);
  // « Suppléances » from here too (a phone's bottom bar may have no room for it).
  await page.getByRole('main').getByRole('link', { name: 'Suppléances' }).click();
  await expect(page).toHaveURL(/\/absences$/);
  await expect(page.getByRole('heading', { name: 'Suppléances du jour' })).toBeVisible();
});

test('a teacher’s « Mes absences » lists what is coming', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/absences');
  await expect(page.getByRole('heading', { name: 'Mes absences', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Absences à venir' })).toBeVisible();
  await expectAccessible(page);
});
