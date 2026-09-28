import { expect, test } from '@playwright/test';
import { DEMO, login } from './helpers';

test('the login page switches to English and back', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
});

// The office account is used by no other test, so its saved language cannot leak into them.
test('each account keeps its own language across devices', async ({ page, context }) => {
  // English picked on the login page is kept after signing in, and saved to the account.
  await page.goto('/login');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await login(page, DEMO.office, { stayOnPage: true });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Calendar' }).first()).toBeVisible();

  // A new device: the login page starts in French, then the saved choice applies.
  await context.clearCookies();
  await login(page, DEMO.office);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();

  // Switching back in the profile.
  await page.getByLabel('App language').selectOption('fr-CA');
  await expect(page.getByRole('heading', { name: 'Profil' })).toBeVisible();

  // A shared device left in English by someone else doesn't change this account's language.
  await context.clearCookies();
  await context.addCookies([{ name: 'locale', value: 'en-CA', url: page.url() }]);
  await login(page, DEMO.office);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profil' })).toBeVisible();
});
