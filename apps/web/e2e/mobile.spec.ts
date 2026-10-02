import { expect, test } from '@playwright/test';
import { SEED, closeDb, query, resetLanguage } from './db';
import { DEMO, expectAccessible, login, nextSchoolMonday } from './helpers';

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

test('a teaching vice-principal gets five items and « Plus » (D-118)', async ({ page }) => {
  // Isabelle is also the school's vice-principal for this test: eight items in all, with
  // « Direction ». Without « Suppléances » there are still seven, so the bar shows the first five
  // and « Plus » holds the rest.
  await query(
    `insert into public.user_roles (user_id, role, board_id, school_id)
     values ($1, 'vice_principal', $2, $3)`,
    [ISABELLE, SEED.board, SEED.school],
  );
  try {
    await login(page, DEMO.teacher3);
    await page.goto(`/today?date=${nextSchoolMonday()}`);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' }).last();
    await expect(nav.getByRole('link')).toHaveCount(5);
    for (const name of ['Aujourd’hui', 'Classes', 'Direction', 'Ressources', 'Calendrier']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Suppléances' })).toHaveCount(0);

    // « Plus » holds « Suppléances », « École » and « Profil ». A tap before the page is
    // interactive is lost: retry until the sheet opens.
    const more = page.getByRole('dialog', { name: 'Plus' });
    await expect(async () => {
      if (!(await more.isVisible())) await nav.getByRole('button', { name: 'Plus' }).click();
      await expect(more).toBeVisible({ timeout: 1000 });
    }).toPass();
    for (const name of ['Suppléances', 'École', 'Profil']) {
      await expect(more.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await more.getByRole('link', { name: 'Profil', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);

    // « Suppléances » is also reached from Aujourd'hui.
    await page.goto(`/today?date=${nextSchoolMonday()}`);
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

test('the direction, the office and the board each land on their own page (D-118)', async ({
  page,
  context,
}) => {
  const nav = page.getByRole('navigation', { name: 'Navigation principale' }).last();
  const noHorizontalScroll = async () => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  };

  // A principal who does not teach: « Direction », and six items that fit the bar.
  await login(page, DEMO.principal);
  await expect(page).toHaveURL(/\/direction$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tableau de bord de la direction' }),
  ).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(6);
  for (const name of ['Direction', 'Suppléances', 'Ressources', 'Calendrier', 'École', 'Profil']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Direction', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await noHorizontalScroll();
  await expectAccessible(page);
  // « Aujourd'hui » sends her back to her own page.
  await page.goto('/today');
  await expect(page).toHaveURL(/\/direction$/);

  // Office staff: « Suppléances ».
  await resetLanguage(DEMO.office);
  await context.clearCookies();
  await login(page, DEMO.office);
  await expect(page).toHaveURL(/\/absences$/);
  await expect(nav.getByRole('link', { name: 'Direction', exact: true })).toHaveCount(0);

  // A board admin with no school (and the demo board's resource reviewer): « Conseil ».
  await context.clearCookies();
  await login(page, DEMO.boardAdmin);
  await expect(page).toHaveURL(/\/board$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Administration du conseil' }),
  ).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(4);
  for (const name of ['Ressources', 'Calendrier', 'Conseil', 'Profil']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await noHorizontalScroll();
  await expectAccessible(page);
  // Neither page is anyone else's.
  await page.goto('/direction');
  await expect(page).toHaveURL(/\/board$/);
});
