import { expect, test } from '@playwright/test';
import { SEED, closeDb, query } from './db';
import { DEMO, login, nextSchoolMonday } from './helpers';

const ISABELLE = 'd0000000-0000-4000-8000-000000000001';

test.afterAll(async () => {
  await closeDb();
});

test('the today view works on a phone with the bottom navigation', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/today?date=${nextSchoolMonday()}`);
  const nav = page.getByRole('navigation', { name: 'Navigation principale' }).last();
  await expect(nav.getByRole('link', { name: 'Aujourd’hui' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leçon donnée' }).first()).toBeVisible();
  // No horizontal scrolling on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a teaching principal keeps Profil and École in a bar that fits', async ({ page }) => {
  // Isabelle is also the school's vice-principal for this test: seven items in all.
  await query(
    `insert into public.user_roles (user_id, role, board_id, school_id)
     values ($1, 'vice_principal', $2, $3)`,
    [ISABELLE, SEED.board, SEED.school],
  );
  try {
    await login(page, DEMO.teacher3);
    await page.goto(`/today?date=${nextSchoolMonday()}`);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' }).last();
    await expect(nav.getByRole('link')).toHaveCount(6);
    await expect(nav.getByRole('link', { name: 'Profil' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'École' })).toBeVisible();
    // « Suppléances » is reached from Aujourd'hui instead.
    await expect(nav.getByRole('link', { name: 'Suppléances' })).toHaveCount(0);
    await page.getByRole('main').getByRole('link', { name: 'Suppléances' }).click();
    await expect(page).toHaveURL(/\/absences$/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await query(`delete from public.user_roles where user_id = $1 and role = 'vice_principal'`, [
      ISABELLE,
    ]);
  }
});
