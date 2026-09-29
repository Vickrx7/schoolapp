import { expect, test, type Page } from '@playwright/test';
import {
  absencesOf,
  cleanupAbsences,
  clearProgress,
  closeDb,
  deleteEvent,
  insertPaDay,
  insertSchoolEvent,
  nextLesson,
  query,
  SEED,
  setProgress,
} from './db';
import {
  addDaysIso,
  DEMO,
  expectAccessible,
  isSeededSchoolDay,
  login,
  reportAbsence,
  schoolDay,
} from './helpers';

// « Plan de suppléance », teacher side: publishing builds the plan in the request (no worker),
// the owner reviews and edits it, and changes to the absence rebuild it. The automatic refresh
// and multi-day scenarios need the worker (CI starts it with AI_PROVIDER=fake).
test.describe.configure({ mode: 'serial' });

const createdEvents: string[] = [];

test.beforeAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await cleanupAbsences(DEMO.rotary);
});

test.afterAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await cleanupAbsences(DEMO.rotary);
  for (const id of createdEvents) await deleteEvent(id);
  await closeDb();
});

async function openPlan(page: Page) {
  await page.getByRole('link', { name: 'Réviser le plan' }).first().click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
}

/** Today on the school's clock (America/Toronto), as YYYY-MM-DD. */
function schoolToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
}

/** The lesson numbers of a unit's periods on the open plan, in time order (« Leçon 4 · … »). */
async function lessonNumbers(page: Page, unitTitle: string): Promise<number[]> {
  // Text content, not innerText: the lesson line is upper-cased by CSS.
  const texts = await page
    .getByTestId('plan-block')
    .filter({ hasText: unitTitle })
    .allTextContents();
  return texts.map((text) => Number(/Leçon (\d+) ·/.exec(text)?.[1] ?? NaN));
}

/**
 * A school Friday with the seeded « Messe de l'école » (09:45–10:35, relative to the reset
 * date). When the database was reset long ago, an identical mass is added next week.
 */
async function massFriday(): Promise<string> {
  const rows = await query<{ day: string }>(
    `select to_char(e.starts_on, 'YYYY-MM-DD') as day from public.school_calendar_events e
     where e.school_id = $1 and e.title = 'Messe de l''école' and e.start_time = '09:45'
       and e.starts_on >= current_date and extract(isodow from e.starts_on) = 5
     order by e.starts_on`,
    [SEED.school],
  );
  const seeded = rows.map((r) => r.day).find(isSeededSchoolDay);
  if (seeded) return seeded;
  const day = schoolDay({ weeksAhead: 1, isoWeekday: 5 });
  createdEvents.push(
    await insertSchoolEvent({
      type: 'mass',
      title: 'Messe de l’école',
      date: day,
      start: '09:45',
      end: '10:35',
      notes: 'Au gymnase. Les classes s’y rendent à 9 h 40.',
    }),
  );
  return day;
}

test('a teacher reports an absence and reviews, edits and releases the plan', async ({ page }) => {
  await cleanupAbsences(DEMO.teacher3);
  const wednesday = schoolDay({ weeksAhead: 2, isoWeekday: 3 });
  const french = await nextLesson(SEED.class3, 'fra');
  await login(page, DEMO.teacher3);

  await page.goto('/absences/new');
  await expect(page.getByRole('heading', { name: 'Signaler une absence' })).toBeVisible();
  await expectAccessible(page);
  await reportAbsence(page, { startsOn: wednesday });

  // The plan exists as soon as the absence is published: no background job involved.
  await expect(page.getByTestId('plan-status')).toContainText('Prêt · publié automatiquement');
  await expectAccessible(page);

  await openPlan(page);
  await expect(page.getByText('Entrée, prière du matin et O Canada')).toBeVisible();
  const frenchBlock = page.getByTestId('plan-block').filter({ hasText: french.title }).first();
  await expect(frenchBlock).toBeVisible();
  if (french.subNotes) await expect(frenchBlock).toContainText(french.subNotes.trim());
  const beginners = page.getByTestId('plan-group').filter({ hasText: 'Débutant' }).first();
  for (const name of ['Samuel', 'Adam', 'Aïcha']) await expect(beginners).toContainText(name);
  const contacts = page.getByTestId('plan-contacts');
  await expect(contacts).toContainText('555-0100');
  await expect(contacts).toContainText('M. Gagnon');
  await expectAccessible(page);

  // Edit a step: saved automatically, still there after a reload.
  const firstStep = frenchBlock.getByLabel('Étape 1', { exact: true });
  await expect(async () => {
    if (!(await firstStep.isVisible())) {
      await frenchBlock.getByRole('button', { name: 'Modifier les étapes' }).click();
    }
    await expect(firstStep).toBeVisible({ timeout: 1000 });
  }).toPass();
  const text = `Lisez le texte à voix haute avec les élèves (e2e ${Date.now()}).`;
  await firstStep.fill(text);
  await expect(page.getByTestId('plan-save-status')).toContainText('Enregistré à', {
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByText(text)).toBeVisible();

  await page.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect(page.getByTestId('plan-status')).toHaveText('Publié');
});

test('checking off a lesson moves the plan on by itself (worker)', async ({ page }) => {
  await cleanupAbsences(DEMO.teacher3);
  const wednesday = schoolDay({ weeksAhead: 2, isoWeekday: 3 });
  const french = await nextLesson(SEED.class3, 'fra');
  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: wednesday });
  await openPlan(page);
  const frenchBlocks = page.getByTestId('plan-block').filter({ hasText: french.unitTitle });
  await expect(frenchBlocks.first()).toContainText(french.title);

  // The teacher teaches that lesson today: the worker rebuilds the plan from the next one.
  await setProgress(french.id, schoolToday());
  try {
    const following = await nextLesson(SEED.class3, 'fra');
    expect(following.sequenceNumber).toBe(french.sequenceNumber + 1);
    await expect(async () => {
      await page.reload();
      await expect(frenchBlocks.first()).toContainText(following.title, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(frenchBlocks.first()).not.toContainText(french.title);
  } finally {
    await clearProgress([french.id]);
  }
});

test('a multi-day plan skips a PA day added later and continues the lessons (worker)', async ({
  page,
}) => {
  await cleanupAbsences(DEMO.teacher3);
  // Thursday to Monday with school on the three weekdays, away from the other scenarios' dates.
  let thursday = '';
  for (let weeks = 5; !thursday; weeks++) {
    const day = schoolDay({ weeksAhead: weeks, isoWeekday: 4 });
    if (isSeededSchoolDay(addDaysIso(day, 1)) && isSeededSchoolDay(addDaysIso(day, 4))) {
      thursday = day;
    }
  }
  const monday = addDaysIso(thursday, 4);
  const french = await nextLesson(SEED.class3, 'fra');
  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: thursday, endsOn: monday });
  await expect(page.getByRole('tab')).toHaveCount(3);

  // The board adds a PA day on the Friday: the worker drops that day's plan, and the absence
  // page lists it without a plan.
  const paDay = await insertPaDay(addDaysIso(thursday, 1));
  try {
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole('tab')).toHaveCount(2, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText(/^Ven\. .+ : Journée pédagogique — pas de plan$/)).toBeVisible();

    // Monday's French continues where Thursday's ends.
    const tabs = page.getByRole('tab');
    await tabs.first().click();
    await openPlan(page);
    const thursdayLessons = await lessonNumbers(page, french.unitTitle);
    expect(thursdayLessons.length).toBeGreaterThan(0);
    expect(thursdayLessons[0]).toBe(french.sequenceNumber);
    await page.goBack();
    await tabs.last().click();
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await openPlan(page);
    const mondayLessons = await lessonNumbers(page, french.unitTitle);
    expect(mondayLessons[0]).toBe(thursdayLessons.at(-1)! + 1);
  } finally {
    await deleteEvent(paDay);
  }
});

test('a mass on a Friday replaces the 3e math period', async ({ page }) => {
  await cleanupAbsences(DEMO.teacher3);
  const friday = await massFriday();
  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: friday });
  await openPlan(page);

  const mass = page
    .getByTestId('plan-block')
    .filter({ hasText: /Messe de l.école/ })
    .filter({ hasText: 'Mathématiques' });
  await expect(mass).toHaveCount(1);
  await expect(mass).toContainText('Au gymnase');
  await expect(mass).toContainText('Remplacé');
  // The period gets no math lesson (it moves to the next math period).
  await expect(mass).not.toContainText(/Leçon \d+ ·/);
});

test('a rotary teacher’s plan covers only her periods; the homeroom plan hands over', async ({
  page,
}) => {
  await cleanupAbsences(DEMO.teacher3);
  await cleanupAbsences(DEMO.rotary);
  const tuesday = schoolDay({ weeksAhead: 2, isoWeekday: 2 });

  // Paul Leblanc teaches 3e EPS on Tuesdays at 13:35 in the gym, and nothing else that day.
  await login(page, DEMO.rotary);
  await reportAbsence(page, { startsOn: tuesday });
  await openPlan(page);
  const blocks = page.getByTestId('plan-block');
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first()).toContainText('Éducation physique et santé');
  await expect(blocks.first()).toContainText('13 h 35');
  await expect(blocks.first()).toContainText('Gymnase');
  await expect(page.getByText('Entrée, prière du matin et O Canada')).toHaveCount(0);

  // Isabelle's plan the same day hands her class over to him for that period.
  await page.context().clearCookies();
  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: tuesday });
  await openPlan(page);
  const handover = page
    .getByTestId('plan-block')
    .filter({ hasText: /Éducation physique et santé avec M\. Leblanc/ });
  await expect(handover).toHaveCount(1);
  await expect(handover).toContainText('13 h 35');
  await expect(handover).toContainText('Gymnase');
});

test('an absence is shortened with « Je reviens plus tôt », and another is cancelled', async ({
  page,
}) => {
  await cleanupAbsences(DEMO.teacher3);
  await cleanupAbsences(DEMO.rotary);
  // Thursday to Monday, with school on both days.
  let thursday = '';
  for (let weeks = 3; !thursday; weeks++) {
    const day = schoolDay({ weeksAhead: weeks, isoWeekday: 4 });
    if (isSeededSchoolDay(addDaysIso(day, 4))) thursday = day;
  }
  const monday = addDaysIso(thursday, 4);

  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: thursday, endsOn: monday });
  // One tab per school day: Thursday, Friday (unless a seeded day off) and Monday.
  const schoolDays = [thursday, addDaysIso(thursday, 1), monday].filter(isSeededSchoolDay);
  await expect(page.getByRole('tab')).toHaveCount(schoolDays.length);

  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: 'Modifier / Je reviens plus tôt' }).click();
    }
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dialog.getByLabel('Dernier jour').fill(thursday);
  await dialog.getByRole('button', { name: 'Enregistrer les changements' }).click();
  await expect(page.getByText('Absence modifiée. Le plan est à jour.')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Absence du jeudi/);
  expect((await absencesOf(DEMO.teacher3))[0]).toMatchObject({
    starts_on: thursday,
    ends_on: thursday,
    status: 'published',
  });

  // Paul cancels his absence: its plan and codes go with it.
  await page.context().clearCookies();
  await login(page, DEMO.rotary);
  await reportAbsence(page, { startsOn: schoolDay({ weeksAhead: 4, isoWeekday: 2 }) });
  const cancel = page.getByRole('button', { name: 'Annuler l’absence', exact: true });
  await expect(async () => {
    if (!(await dialog.isVisible())) await cancel.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dialog.getByRole('button', { name: 'Annuler l’absence', exact: true }).click();
  await page.waitForURL(/\/absences$/);
  await expect(page.getByText('Absence annulée.')).toBeVisible();
  const [paul] = await absencesOf(DEMO.rotary);
  expect(paul?.status).toBe('cancelled');
  const plans = await query('select 1 from public.sub_plans where absence_id = $1', [paul!.id]);
  expect(plans).toHaveLength(0);
});
