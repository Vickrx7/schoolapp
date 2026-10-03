import { expect, test } from '@playwright/test';
import { closeDb, resetLanguage } from './db';
import { DEMO, login } from './helpers';

// Headings are matched exactly: « Profil » is a substring of "Profile", so a loose match would
// pass before the switch back to French has been saved.

test.afterAll(async () => {
  // Whatever happened above, the office account is French again for the specs that follow.
  await resetLanguage(DEMO.office);
  await closeDb();
});

test('the login page switches to English and back', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
});

// The office account's saved language changes here (and is put back in afterAll); the other
// specs that use that account reset it too, so they never depend on this test's outcome.
test('each account keeps its own language across devices', async ({ page, context }) => {
  const heading = (name: string) => page.getByRole('heading', { name, exact: true });

  // English picked on the login page is kept after signing in, and saved to the account.
  await page.goto('/login');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await login(page, DEMO.office, { stayOnPage: true });
  await page.goto('/profile');
  await expect(heading('Profile')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Calendar' }).first()).toBeVisible();

  // A new device: the login page starts in French, then the saved choice applies.
  await context.clearCookies();
  await login(page, DEMO.office);
  await page.goto('/profile');
  await expect(heading('Profile')).toBeVisible();

  // Switching back in the profile: the page re-renders in French once the choice is saved.
  await page.getByLabel('App language').selectOption('fr-CA');
  await expect(heading('Profil')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');

  // A shared device left in English by someone else doesn't change this account's language.
  await context.clearCookies();
  await context.addCookies([{ name: 'locale', value: 'en-CA', url: page.url() }]);
  await login(page, DEMO.office);
  await page.goto('/profile');
  await expect(heading('Profil')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
});
