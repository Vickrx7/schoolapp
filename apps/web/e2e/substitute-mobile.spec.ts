import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { cleanupAbsences, clearAttempts, closeDb, openCodeWindow, planIdOn } from './db';
import { DEMO, expectAccessible, login, reportAbsence, schoolDay, torontoInstant } from './helpers';

// « Plan de suppléance » on a phone (the `phone` project runs *mobile.spec.ts on a Pixel 7): the
// teacher reports an absence and gives a code; the substitute signs in, finds « Maintenant » and
// sends the end-of-day report.

test.beforeAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await clearAttempts();
});

test.afterAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await clearAttempts();
  await closeDb();
});

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * The phone's bottom navigation never covers an action: scrolled as far as it can go towards
 * the middle of the screen, the action ends above the bar.
 */
async function expectAboveBottomBar(page: Page, action: Locator) {
  const nav = page.getByRole('navigation', { name: 'Navigation principale' }).last();
  await action.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const [box, navBox] = await Promise.all([action.boundingBox(), nav.boundingBox()]);
  expect(box).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y);
}

test('a teacher reports an absence from Aujourd’hui in two taps', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/today');
  await expectNoHorizontalScroll(page);

  // Tap 1: « Je suis absent·e ».
  await page.getByRole('link', { name: 'Je suis absent·e' }).click();
  await page.waitForURL(/\/absences\/new$/);
  // The date is already chosen (today before dismissal, otherwise the next school day); the
  // summary arrives from the server once the form is interactive.
  await expect(page.getByTestId('absence-summary')).toContainText('à couvrir');
  const send = page.getByRole('button', { name: 'Envoyer' });
  await expectAboveBottomBar(page, send);
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);

  // Tap 2: « Envoyer ».
  await send.click();
  await page.waitForURL(/\/absences\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('plan-status').first()).toBeVisible();
  await expect(page.getByTestId('plan-status').first()).toHaveText(/^(Prêt|Publié)/);
  await expectNoHorizontalScroll(page);
  await expectAboveBottomBar(page, page.getByRole('link', { name: 'Réviser le plan' }).first());
  await expectAboveBottomBar(
    page,
    page.getByRole('button', { name: 'Annuler l’absence', exact: true }),
  );
  await expectAccessible(page);
});

test('a substitute signs in on a phone and finds what is happening now', async ({
  page,
  browser,
}) => {
  await cleanupAbsences(DEMO.teacher3);
  // A Thursday four weeks ahead: 3e année has Mathématiques at 9 h 45 every day.
  const thursday = schoolDay({ weeksAhead: 4, isoWeekday: 4 });
  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: thursday });
  const absenceId = /\/absences\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  await page.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect(page.getByTestId('plan-status').first()).toHaveText('Publié');

  // « Code pour la personne suppléante » on the absence page, shown once.
  const generate = page.getByRole('button', { name: 'Code pour la personne suppléante' });
  await expectAboveBottomBar(page, generate);
  await generate.click();
  const code = (await page.getByTestId('sub-code').textContent())!.trim();
  expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByText('1 code actif')).toBeVisible();

  // The substitute's own phone, at 10 h on the plan date (the code window follows the real
  // clock; « Maintenant » follows the phone's).
  await openCodeWindow(await planIdOn(absenceId, thursday));
  const use = test.info().project.use;
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    baseURL: use.baseURL,
    locale: use.locale,
    timezoneId: use.timezoneId,
  });
  try {
    const sub = await context.newPage();
    await sub.clock.setFixedTime(torontoInstant(thursday, '10:00'));
    await sub.goto('/suppleance');
    await sub.getByLabel('Code d’accès').fill(code);
    await sub.getByRole('button', { name: 'Commencer' }).click();
    await sub.waitForURL(/\/suppleance\/plan$/);
    const timeline = sub.getByTestId('timeline');
    await expect(timeline).toContainText('Maintenant');
    await expect(timeline).toContainText('9 h 45 – 10 h 35');
    await expect(timeline).toContainText('Mathématiques');
    await expect(timeline).toContainText('Ensuite');
    await expect(sub.getByText('Valide jusqu’à')).toBeVisible();
    await expectNoHorizontalScroll(sub);
    await expectAccessible(sub);

    await sub.getByRole('tab', { name: 'Fin de journée' }).click();
    await expect(sub.getByRole('link', { name: 'Aller à la fin de la journée' })).toBeVisible();
    await expectNoHorizontalScroll(sub);

    // « Suivi de la journée » on the phone: chips to tap, nothing to scroll sideways, and the
    // send button stays in reach.
    await sub.getByRole('link', { name: 'Remplir le suivi de la journée' }).click();
    await sub.waitForURL(/\/suppleance\/report$/);
    const first = sub.getByTestId('report-lesson').first();
    const done = first.locator('label').filter({ hasText: /^Terminé$/ });
    await expect(async () => {
      await done.click();
      await expect(first.getByRole('radio', { name: 'Terminé' })).toBeChecked({ timeout: 1000 });
    }).toPass();
    await sub
      .locator('label')
      .filter({ hasText: /^Samuel$/ })
      .click();
    await sub.getByLabel('Notes pour l’enseignant·e').fill('Merci pour le plan clair!');
    await expect(sub.getByTestId('report-save-state')).toContainText('Brouillon enregistré à', {
      timeout: 15_000,
    });
    await expectNoHorizontalScroll(sub);
    await expectAccessible(sub);
    const send = sub.getByRole('button', { name: 'Envoyer le suivi' });
    await expect(send).toBeInViewport();
    await send.click();
    await sub.waitForURL(/\/suppleance\/done$/);
    await expect(sub.getByRole('heading', { name: 'Merci!' })).toBeVisible();
    await expectNoHorizontalScroll(sub);
  } finally {
    await context.close();
  }
});
