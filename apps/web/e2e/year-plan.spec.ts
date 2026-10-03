import { addDays, localDateIn, mondayOf } from '@lynx/domain';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, clearProgress, closeDb, query, setProgress } from './db';
import { UNITS, deleteUnitsTitled, insertPlannedUnit, unitPlan, unitStatus } from './db-year-plan';
import { DEMO, e2ePrefix, expectAccessible, isSeededSchoolDay, login, schoolDay } from './helpers';

/**
 * « Mon année », slices S2 and S3 (DECISIONS D-125 to D-127), on a desktop: Isabelle's 3e année
 * on the weeks of 2026-2027, with the calendar (« Pas d'école » over the holidays), the report
 * dates and the liturgical seasons; « Planifier une unité » from the year, its cell and the
 * overlap it makes; « Couverture », each attente taught or planned from the class's own lessons
 * and units; « Plan à long terme (PDF) »; and « Aujourd'hui », where a planned unit due that week
 * is started with « Commencer l'unité ». The units the spec makes are deleted at the end.
 */

const PREFIX = e2ePrefix('an-');
const YEAR_PAGE = `/classes/${SEED.class3}/planning/year`;
const COVERAGE_PAGE = `/classes/${SEED.class3}/planning/coverage`;
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
  // The seed's « Messe de l'école » is on the first school Friday after the reset: in the
  // Thanksgiving week when the database was reset between 3 and 9 October (never on the PA day).
  const [mass] = await query<{ day: string }>(
    `select to_char(starts_on, 'FMDD') as day from public.school_calendar_events
     where school_id = $1 and title = 'Messe de l''école'
       and starts_on between '2026-10-12' and '2026-10-16'`,
    [SEED.school],
  );
  const thanksgiving = mass
    ? `4 jours de classe Action de grâce Messe\\s: Messe de l['’]école, le ${mass.day} octobre`
    : '4 jours de classe Action de grâce';
  await expect(grid.getByRole('cell', { name: new RegExp(`^${thanksgiving}$`) })).toBeVisible();
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

/** The seeded 3e Français unit's lessons 4 to 8: none is given in the seed (lesson 4 aims at C1.2). */
async function fraLessonsLeft(): Promise<{ id: string; seq: number }[]> {
  return query<{ id: string; seq: number }>(
    `select id, sequence_number as seq from public.unit_lessons
     where unit_id = $1 and sequence_number >= 4 order by sequence_number`,
    [UNITS.fra3],
  );
}

/** An attente's item in the coverage list, by its code. */
const attente = (page: Page, code: string) =>
  page.locator(`[data-testid="coverage-expectation"][data-code="${code}"]`);

test('« Couverture » shows each attente taught or planned, from the lessons and units', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const left = await fraLessonsLeft();
  // As the seed left them (lessons 1 to 3 given), whatever ran before.
  await clearProgress(left.map((l) => l.id));
  const lesson4 = left.find((l) => l.seq === 4)!.id;
  try {
    await login(page, DEMO.teacher3);
    await page.goto(YEAR_PAGE);
    const tabs = page.getByRole('navigation', { name: 'Sections de la planification' });
    await tabs.getByRole('link', { name: 'Couverture' }).click();
    await page.waitForURL(new RegExp(`${escape(COVERAGE_PAGE)}$`));
    await expect(page).toHaveTitle(/^Couverture · 3e année/);
    await expect(tabs.getByRole('link', { name: 'Couverture' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.getByRole('heading', { level: 2, name: 'Couverture des attentes · 2026-2027' }),
    ).toBeVisible();

    // « Vue d'ensemble »: the whole year per subject with attentes loaded (32 counted in the
    // demo's 3e Français: the specific attentes; the overall ones are headings).
    const overview = page.getByRole('region', { name: 'Vue d’ensemble' });
    const overviewOf = (subject: string) =>
      overview
        .getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: subject, exact: true }) })
        .getByTestId('coverage-overview-counts');
    await expect(overviewOf('Français')).toHaveText(
      '32 attentes · 2 enseignées · 2 prévues · 28 pas encore prévues',
    );
    await expect(overviewOf('Mathématiques')).toHaveText(/^\d+ attentes · /);
    await expect(
      overview.getByText(/^Aucune attente chargée\s:\s.*Éducation artistique/),
    ).toBeVisible();
    await expectAccessible(page);

    // Français, the whole year.
    await overview.getByRole('link', { name: 'Français', exact: true }).click();
    await page.waitForURL(/\/planning\/coverage\?subject=/);
    const list = page.getByRole('region', { name: 'Français · 3e année' });
    await expect(list.getByText('Période\u00a0: toute l’année')).toBeVisible();
    await expect(page.getByTestId('coverage-counts')).toHaveText(
      '32 attentes · 2 enseignées · 2 prévues · 28 pas encore prévues',
    );
    // Lessons 2 and 3 were given; lesson 4 (C1.2) not yet, and the unit aims at it.
    await expect(attente(page, 'C1.1')).toContainText('Enseignée');
    await expect(attente(page, 'C1.1')).toContainText(
      /1 leçon donnée \(dernière le \d+(er)? \S+\)/,
    );
    await expect(
      attente(page, 'C1.1').getByRole('link', {
        name: /^Unité «\sLire pour s'informer : les animaux de l'Ontario\s» \(/,
      }),
    ).toBeVisible();
    await expect(attente(page, 'C1.3')).toContainText('Enseignée');
    await expect(attente(page, 'C1.2').getByText('Prévue', { exact: true })).toBeVisible();
    await expect(
      attente(page, 'C1.4').getByText('Pas encore prévue', { exact: true }),
    ).toBeVisible();
    // An overall attente with contenus is their heading.
    await expect(list.getByText('2 sur 4 enseignées')).toBeVisible();
    await expect(
      list.getByText(/^Attentes résumées, à vérifier contre le programme officiel/),
    ).toBeVisible();
    await list.getByText('Comment on compte').click();
    await expect(list.getByText(/^«\sEnseignée \(unité terminée\)\s»\s:/)).toBeVisible();
    await expectAccessible(page);

    // « Afficher : Prévues »: the planned attentes only; the counts stay.
    await list.getByRole('link', { name: 'Prévues', exact: true }).click();
    await page.waitForURL(/show=planned/);
    await expect(page.getByTestId('coverage-expectation')).toHaveCount(2);
    await expect(attente(page, 'C1.2')).toBeVisible();
    await expect(attente(page, 'D1.1')).toBeVisible();
    await expect(page.getByTestId('coverage-counts')).toHaveText(
      '32 attentes · 2 enseignées · 2 prévues · 28 pas encore prévues',
    );
    await list.getByRole('link', { name: 'Toutes', exact: true }).click();
    await page.waitForURL((url) => !url.search.includes('show='));

    // Lesson 4 given: C1.2 « Enseignée ».
    await setProgress(lesson4, TODAY);
    await page.reload();
    await expect(attente(page, 'C1.2').getByText('Enseignée', { exact: true })).toBeVisible();
    await expect(page.getByTestId('coverage-counts')).toHaveText(
      '32 attentes · 3 enseignées · 1 prévue · 28 pas encore prévues',
    );
    await clearProgress([lesson4]);

    // The periods: the board's report periods, and « Dates choisies ».
    const period = page.getByLabel('Période');
    await expect(period.locator('option')).toHaveText([
      'Toute l’année',
      'Bulletin de progrès (2 sept.–30 oct.)',
      'Bulletin scolaire — 1re étape (2 sept.–29 janv.)',
      'Bulletin scolaire — 2e étape (1er févr.–11 juin)',
      'Dates choisies',
    ]);
    await period.selectOption({ label: 'Bulletin de progrès (2 sept.–30 oct.)' });
    await page.getByRole('button', { name: 'Afficher la couverture' }).click();
    await page.waitForURL(/period=progress/);
    await expect(
      page.getByText('Période\u00a0: Bulletin de progrès, du 2 septembre au 30 octobre'),
    ).toBeVisible();

    // After the seeded windows: what was given is « Enseignée avant la période ».
    const from = addDays(TODAY, 70);
    const to = addDays(TODAY, 100);
    await page.getByLabel('Période').selectOption({ label: 'Dates choisies' });
    await page.getByLabel('Du', { exact: true }).fill(from);
    await page.getByLabel('Au', { exact: true }).fill(to);
    await page.getByRole('button', { name: 'Afficher la couverture' }).click();
    await page.waitForURL(new RegExp(`period=custom&from=${from}&to=${to}`));
    await expect(attente(page, 'C1.1').getByText('Enseignée avant la période')).toBeVisible();
    await expect(
      attente(page, 'C1.2').getByText('Pas encore prévue', { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('coverage-counts')).toContainText(
      '2 enseignées avant la période',
    );
    await expectAccessible(page);

    // Dates in the wrong order: the whole year, and why.
    await page.goto(
      `${COVERAGE_PAGE}?${new URLSearchParams({
        subject: new URL(page.url()).searchParams.get('subject')!,
        period: 'custom',
        from: to,
        to: from,
      }).toString()}`,
    );
    await expect(
      page.getByText(/^Choisissez deux dates, la première avant la seconde\./),
    ).toBeVisible();
    await expect(page.getByText('Période\u00a0: toute l’année')).toBeVisible();
  } finally {
    await clearProgress([lesson4]);
  }
});

test('« Plan à long terme (PDF) »: built on demand, never cached, coverage only when asked', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await page.goto(YEAR_PAGE);
  const button = page.getByRole('button', { name: 'Plan à long terme (PDF)' });
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleDescription(
    /^Ce document est à vous\s:\svous décidez à qui le remettre\.$/,
  );
  const withCoverage = page.getByRole('checkbox', { name: 'Inclure la couverture des attentes' });
  await expect(withCoverage).not.toBeChecked();

  const pages = (body: Buffer) => body.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  const sizes: number[] = [];
  for (const query of ['', '?coverage=1', '?download=1']) {
    const response = await page.request.get(`${YEAR_PAGE}/pdf${query}`);
    expect(response.status(), query).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toBe('application/pdf');
    expect(headers['cache-control']).toBe('private, no-store');
    // A PDF route carries no page security policy (it would stop the browser's viewer).
    expect(headers['content-security-policy']).toBeUndefined();
    expect(headers['content-disposition']).toMatch(
      new RegExp(
        `^${query === '?download=1' ? 'attachment' : 'inline'}; filename="plan-a-long-terme-3e-annee-[a-z0-9-]+-2026-2027\\.pdf"$`,
      ),
    );
    const body = await response.body();
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    sizes.push(pages(body));
  }
  // The year at a glance and the units; « Couverture des attentes » only when asked.
  expect(sizes[1]).toBe(sizes[0]! + 1);
  expect(sizes[2]).toBe(sizes[0]);

  // Only the class team: Marc's 5e année is not Isabelle's.
  expect((await page.request.get(`/classes/${SEED.class5}/planning/year/pdf`)).status()).toBe(404);
  expect((await page.request.get('/classes/not-a-class/planning/year/pdf')).status()).toBe(404);

  // The form asks for the coverage when it is ticked.
  await withCoverage.check();
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/planning/year/pdf')),
    button.click(),
  ]);
  expect(new URL(request.url()).search).toBe('?coverage=1');
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
