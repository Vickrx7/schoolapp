import { addDays, localDateIn, mondayOf } from '@lynx/domain';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb, query } from './db';
import { UNITS, deleteUnitsTitled, insertPlannedUnit, unitPlan, unitStatus } from './db-year-plan';
import { DEMO, e2ePrefix, expectAccessible, isSeededSchoolDay, login, schoolDay } from './helpers';

/**
 * « Mon année », slice S2 (DECISIONS D-126), on a desktop: Isabelle's 3e année on the weeks of
 * 2026-2027, with the calendar (« Pas d'école » over the holidays), the report dates and the
 * liturgical seasons; « Planifier une unité » from the year, its cell and the overlap it makes;
 * and « Aujourd'hui », where a planned unit due that week is started with « Commencer l'unité ».
 * The units the spec makes are deleted at the end.
 */

const PREFIX = e2ePrefix('an-');
const YEAR_PAGE = `/classes/${SEED.class3}/planning/year`;
const TODAY = localDateIn('America/Toronto');

test.afterAll(async () => {
  await deleteUnitsTitled(PREFIX);
  await closeDb();
});

/** Opens a dialog from its button, retrying a tap made before the page was interactive. */
async function openDialog(button: Locator, dialog: Locator) {
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** A unit's button in the year grid (its name starts with its title, then its status). */
const unitCell = (page: Page, title: string) =>
  page.getByRole('table').getByRole('button', { name: new RegExp(`^${escape(title)} · `) });

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const longDate = (date: string) =>
  new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/^1 /, '1er ');

test('« Mon année » shows the units on the weeks, the calendar, report dates and seasons', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/classes/${SEED.class3}/planning`);
  // « Unités · Mon année » inside the class's « Planification » tab.
  const tabs = page.getByRole('navigation', { name: 'Sections de la planification' });
  await expect(tabs.getByRole('link', { name: 'Unités' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Mon année' }).click();
  await page.waitForURL(new RegExp(`${escape(YEAR_PAGE)}$`));
  await expect(page).toHaveTitle(/^Mon année · 3e année/);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Mon année · 2026-2027' }),
  ).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Mon année' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: 'Planification', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const grid = page.getByRole('table');
  await expect(grid).toBeVisible();
  // The weeks, by their first day; the year starts on a Wednesday.
  await expect(grid.getByRole('columnheader', { name: 'Semaine du 2 septembre' })).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'Semaine du 7 septembre' })).toBeVisible();
  await expect(
    grid.getByRole('columnheader', {
      name: `Semaine du ${longDate(mondayOf(TODAY))} (Cette semaine)`,
    }),
  ).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'Septembre 2026' })).toBeVisible();

  // The seeded units, the one under way and the planned one after it.
  await expect(unitCell(page, "Les nombres jusqu'à 1 000")).toContainText('En cours');
  await expect(unitCell(page, "L'addition et la soustraction jusqu'à 1 000")).toContainText(
    'À venir',
  );
  await expect(unitCell(page, "L'addition et la soustraction jusqu'à 1 000")).toHaveAccessibleName(
    /· Mathématiques, du \d+(er)? \S+ au \d+(er)? \S+$/,
  );

  // The calendar: no school over the holidays, partial weeks, masses.
  await expect(grid.getByRole('cell', { name: 'Pas d’école Congé des Fêtes' })).toHaveCount(2);
  await expect(
    grid.getByRole('cell', { name: /^4 jours de classe Action de grâce$/ }),
  ).toBeVisible();
  await expect(
    grid.getByText(/^Messe\s: Messe du mercredi des Cendres, le 10 février$/),
  ).toBeAttached();
  // The report dates (the demo board's, supabase/seeds/50_year_plan_demo.sql).
  await expect(
    grid.getByText(/^Bulletin de progrès\s: fin de la période d’évaluation le 30 octobre$/),
  ).toBeAttached();
  await expect(
    grid.getByText(/^Bulletin de progrès\s: saisie au plus tard le 6 novembre$/),
  ).toBeAttached();
  await expect(
    grid.getByText(/^Bulletin scolaire — 1re étape\s: remise aux familles le 12 février$/),
  ).toBeAttached();
  // The seasons, each with its name.
  await expect(grid.getByText('Avent, du 29 novembre au 24 décembre')).toBeAttached();
  await expect(grid.getByText('Avent', { exact: true })).toBeAttached();
  await expect(grid.getByText('Carême', { exact: true })).toBeAttached();
  await expect(grid.getByText('Temps pascal', { exact: true })).toBeAttached();
  // The subject rows: those with units or timetable blocks.
  for (const subject of ['Français', 'Mathématiques', 'Sciences et technologie']) {
    await expect(grid.getByRole('rowheader', { name: subject })).toBeVisible();
  }
  // The box scrolls sideways; the page does not.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page);

  // A unit's cell opens its planning; the focus comes back to it.
  const cell = unitCell(page, "L'addition et la soustraction jusqu'à 1 000");
  const dialog = page.getByRole('dialog', { name: 'Planification de l’unité' });
  await openDialog(cell, dialog);
  await expect(dialog.getByLabel('Titre de l’unité')).toHaveValue(
    "L'addition et la soustraction jusqu'à 1 000",
  );
  await expect(dialog.getByRole('button', { name: 'Ouvrir l’unité' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(cell).toBeFocused();
});

test('« Planifier une unité » from the year: its cell and the overlap it makes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const title = `${PREFIX} Écrire un récit`;
  // From the last week of the seeded Français unit, for three weeks: they overlap.
  const fra = await unitPlan(UNITS.fra3);
  const first = mondayOf(fra.planned_end_on!);
  const last = addDays(first, 14);

  await login(page, DEMO.teacher3);
  await page.goto(YEAR_PAGE);
  const dialog = page.getByRole('dialog', { name: 'Planifier une unité' });
  await openDialog(page.getByRole('button', { name: 'Planifier une unité' }).first(), dialog);
  await dialog.getByLabel('Matière', { exact: true }).selectOption({ label: 'Français' });
  await dialog.getByLabel('Titre de l’unité').fill(title);
  await dialog.getByLabel('Première semaine').selectOption(first);
  await dialog.getByLabel('Dernière semaine').selectOption(last);
  await expect(dialog.getByText(/^3 semaines\s·\s\d+ jours de classe$/)).toBeVisible();
  const box = (code: string) =>
    dialog.getByRole('checkbox', { name: new RegExp(`^${code.replace('.', '\\.')}\\s`) });
  await box('C1.1').check();
  await box('D1.1').check();
  await expect(dialog.getByText('2 attentes choisies')).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Planification enregistrée.')).toBeVisible();
  await expect(dialog).toBeHidden();

  // Its cell, « À venir » (« Pas encore commencée » once its first week has passed).
  await expect(unitCell(page, title)).toContainText(
    first >= mondayOf(TODAY) ? 'À venir' : 'Pas encore commencée',
  );
  // The overlap with the unit under way, in words.
  await expect(
    page.getByText(
      new RegExp(
        `^Chevauchement\\s: «\\s${escape(fra.title)}\\s» et «\\s${escape(title)}\\s» \\(Français\\), du ${escape(longDate(first))} au ${escape(longDate(fra.planned_end_on!))}\\.$`,
      ),
    ),
  ).toBeVisible();
  await expectAccessible(page);

  // Saved as its weeks (Monday to Friday) with its two attentes.
  const [row] = await query<{ planned_start_on: string; planned_end_on: string; codes: string[] }>(
    `select u.planned_start_on::text, u.planned_end_on::text,
       array(select e.code from public.unit_expectations ue
         join public.curriculum_expectations e on e.id = ue.expectation_id
         where ue.unit_id = u.id order by e.code) as codes
     from public.units u where u.title = $1`,
    [title],
  );
  expect(row).toEqual({
    planned_start_on: first,
    planned_end_on: addDays(last, 4),
    codes: ['C1.1', 'D1.1'],
  });
});

test('« Aujourd’hui » offers to start a planned unit due that week', async ({ page }) => {
  test.setTimeout(120_000);
  // A Wednesday (3e année has Sciences at 11 h 15), and a unit planned over its week and the next.
  const date = schoolDay({ weeksAhead: 0, isoWeekday: 3 });
  const title = `${PREFIX} Les plantes`;
  const unitId = await insertPlannedUnit({
    classId: SEED.class3,
    subjectCode: 'sci',
    title,
    startsOn: mondayOf(date),
    endsOn: addDays(mondayOf(date), 11),
    lessons: ['Les parties d’une plante', 'Ce dont une plante a besoin'],
  });

  await login(page, DEMO.teacher3);
  await page.goto(`/today?date=${date}`);
  const block = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Sciences et technologie' }) });
  await expect(block).toContainText(
    new RegExp(
      `Aucune unité en cours\\. «\\s${escape(title)}\\s» est prévue à partir du ${escape(longDate(mondayOf(date)))}\\.`,
    ),
  );
  const start = block.getByRole('button', { name: 'Commencer l’unité' });
  await expect(start).toBeVisible();
  await expectAccessible(page);

  // One tap starts it: the block shows its first lesson.
  const lesson = block.getByText('Les parties d’une plante');
  await expect(async () => {
    if (await start.isVisible()) await start.click();
    await expect(lesson).toBeVisible({ timeout: 2000 });
  }).toPass();
  // (A tap repeated before the page refreshed starts it again, harmlessly: two toasts.)
  await expect(
    page.getByText(new RegExp(`^«\\s${escape(title)}\\s» est en cours\\.$`)).first(),
  ).toBeVisible();
  await expect(block.getByRole('button', { name: 'Commencer l’unité' })).toHaveCount(0);
  expect(await unitStatus(unitId)).toBe('active');
  await expectAccessible(page);

  // « Mon année » says so.
  await page.goto(YEAR_PAGE);
  await expect(unitCell(page, title)).toContainText('En cours');
});

test('« Aujourd’hui » names the next planned unit beside the unit under way', async ({ page }) => {
  // The seed's planned 3e Mathématiques unit, on a Tuesday or Wednesday of its first week.
  const [planned] = await query<{ starts: string }>(
    `select planned_start_on::text as starts from public.units
     where class_id = $1 and title = 'L''addition et la soustraction jusqu''à 1 000'`,
    [SEED.class3],
  );
  const date = [1, 2].map((n) => addDays(planned!.starts, n)).find(isSeededSchoolDay)!;
  await login(page, DEMO.teacher3);
  await page.goto(`/today?date=${date}`);
  const math = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Mathématiques' }) })
    .first();
  // « Les nombres jusqu'à 1 000 » still has lessons: its next one, then the hint.
  await expect(math).toContainText('Prochaine leçon');
  await expect(math.getByTestId('next-planned-unit')).toHaveText(
    /^Prochaine unité prévue\s:\s«\sL'addition et la soustraction jusqu'à 1 000\s» \(à partir du \d+(er)? \S+\)\. Mon année$/,
  );
  await expect(math.getByRole('button', { name: 'Commencer l’unité' })).toHaveCount(0);
  await expectAccessible(page);
  await math.getByRole('link', { name: 'Mon année' }).click();
  await page.waitForURL(new RegExp(`${escape(YEAR_PAGE)}$`));
});
