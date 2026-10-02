import { localDateIn } from '@lynx/domain';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb } from './db';
import { DEMO, expectAccessible, isSeededSchoolDay, login } from './helpers';

/**
 * « Mon année » on a phone (DECISIONS D-126), at the narrowest width the app supports (360 px):
 * the year as a list of months instead of the grid, each with its school days, days off, report
 * dates and units, nothing scrolling sideways, every control a 44 px target, and the planning
 * dialog as a bottom sheet.
 */

const YEAR = { startsOn: '2026-09-02', endsOn: '2027-06-25' };
const MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

test.use({ viewport: { width: 360, height: 740 } });

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

/** « Octobre 2026 · 20 jours de classe »: this month, with the seed's days off. */
function thisMonthHeading(today: string): RegExp {
  const [y, m] = today.split('-').map(Number) as [number, number];
  let days = 0;
  for (let d = 1; d <= 31; d++) {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (new Date(`${date}T12:00:00Z`).getUTCMonth() + 1 !== m) break;
    if (date >= YEAR.startsOn && date <= YEAR.endsOn && isSeededSchoolDay(date)) days += 1;
  }
  return new RegExp(`^${MONTHS[m - 1]} ${y} · ${days} jours de classe$`);
}

test('the year as a list of months on a phone', async ({ page }) => {
  test.setTimeout(90_000);
  const today = localDateIn('America/Toronto');
  await login(page, DEMO.teacher3);
  await page.goto(`/classes/${SEED.class3}/planning/year`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Mon année · 2026-2027' }),
  ).toBeVisible();
  // No grid on a phone: the months instead.
  await expect(page.getByRole('table')).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Septembre 2026 · 21 jours de classe' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Décembre 2026 · 14 jours de classe' }),
  ).toBeVisible();
  const december = page.getByRole('region', { name: 'Décembre 2026 · 14 jours de classe' });
  await expect(december.getByText('Congé des Fêtes · 21 déc.–31 déc.')).toBeVisible();
  await expect(december.getByText('Avent · 29 nov.–24 déc.')).toBeVisible();
  await expect(december.getByText('Aucune unité ce mois-ci.')).toBeVisible();
  const november = page.getByRole('region', { name: /^Novembre 2026 · / });
  await expect(
    november.getByText(/^Bulletin de progrès\s: saisie au plus tard le 6 novembre$/),
  ).toBeVisible();

  // This month: marked, and its units as 44 px buttons.
  const month = page.getByRole('region', { name: thisMonthHeading(today) });
  await expect(month.getByText('Ce mois-ci', { exact: true })).toBeVisible();
  const unit = month.getByRole('button', {
    name: /^Français · Lire pour s'informer : les animaux de l'Ontario · .+ · En cours$/,
  });
  await expect(unit).toBeVisible();
  await tall(unit);
  await tall(page.getByRole('button', { name: 'Planifier une unité' }));
  await noHorizontalScroll(page);
  await expectAccessible(page);

  // The unit's planning: a bottom sheet across the screen, with 44 px fields.
  const dialog = page.getByRole('dialog', { name: 'Planification de l’unité' });
  await expect(async () => {
    if (!(await dialog.isVisible())) await unit.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  const sheet = await dialog.boundingBox();
  expect(Math.round(sheet!.x)).toBe(0);
  expect(Math.round(sheet!.width)).toBe(360);
  await expect(dialog.getByLabel('Titre de l’unité')).toHaveValue(
    "Lire pour s'informer : les animaux de l'Ontario",
  );
  for (const field of ['Titre de l’unité', 'Première semaine', 'Dernière semaine']) {
    await tall(dialog.getByLabel(field, { exact: true }));
  }
  await tall(dialog.getByRole('button', { name: 'Enregistrer', exact: true }));
  await tall(dialog.getByRole('button', { name: 'Ouvrir l’unité' }));
  await expect(dialog.getByRole('checkbox', { name: /^C1\.1\s/ })).toBeVisible();
  await tall(dialog.getByLabel('Filtrer les attentes'));
  await noHorizontalScroll(page);
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // « Planifier une unité »: the subject first.
  const create = page.getByRole('dialog', { name: 'Planifier une unité' });
  const open = page.getByRole('button', { name: 'Planifier une unité' });
  await expect(async () => {
    if (!(await create.isVisible())) await open.click();
    await expect(create).toBeVisible({ timeout: 1000 });
  }).toPass();
  await tall(create.getByLabel('Matière', { exact: true }));
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(create).toBeHidden();
});
