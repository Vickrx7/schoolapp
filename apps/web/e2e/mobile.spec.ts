import { expect, test } from '@playwright/test';
import { DEMO, login, nextSchoolMonday } from './helpers';

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
