import { expect, test, type Locator, type Page } from '@playwright/test';
import { cleanupAbsences, closeDb } from './db';
import { DEMO, expectAccessible, login } from './helpers';

// « Plan de suppléance » on a phone (the `phone` project runs *mobile.spec.ts on a Pixel 7).
// The substitute's side (code, « Maintenant », report) is added with the portal.

test.beforeAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
});

test.afterAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
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
