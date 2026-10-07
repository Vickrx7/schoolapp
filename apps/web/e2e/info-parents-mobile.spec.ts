import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb } from './db';
import { deleteNewsletters } from './db-newsletters';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Info-parents » on a phone (DECISIONS D-136, D-137, D-141), 360 × 740: the list, « Préparer le
 * message », then the editor with « Français · English » per section (one language at a time) and
 * « Partager » (copy, print), every target at least 44 px and no sideways scroll. The message made
 * here is deleted.
 */
test.use({ viewport: { width: 360, height: 740 } });

test.beforeAll(() => deleteNewsletters(SEED.class3));
test.afterAll(async () => {
  await deleteNewsletters(SEED.class3);
  await closeDb();
});

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

/** Every visible control in `region` is at least 44 px high and wide. */
async function expectTargets(region: Locator) {
  const targets = region.locator(
    'a, button, select, textarea, summary, input:not([type=checkbox]), label:has(input[type=checkbox])',
  );
  const count = await targets.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    const what = (await target.evaluate((e) => e.outerHTML.slice(0, 120))) ?? '';
    expect(box!.height, what).toBeGreaterThanOrEqual(44);
    expect(box!.width, what).toBeGreaterThanOrEqual(44);
  }
}

test('« Info-parents » on a phone: the list, preparing, one language at a time, 44 px targets', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, DEMO.teacher3);
  await page.goto(`/classes/${SEED.class3}/info-parents`);
  await expect(page.getByText('Aucun message pour l’instant.')).toBeVisible();
  // The class's tabs: « Info-parents » scrolled into view, an arrow says more tabs are to its left.
  const tab = page
    .getByRole('navigation', { name: 'Aperçu' })
    .getByRole('link', { name: 'Info-parents' });
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(tab).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('class-tabs-more-before')).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectTargets(page.getByTestId('prepare-weeks'));
  await expectAccessible(page);

  await page
    .getByRole('link', { name: /^Préparer la semaine du / })
    .first()
    .click();
  const prepare = page.locator('main form');
  await expect(prepare.getByRole('button', { name: 'Préparer le message' })).toBeEnabled();
  await expectTargets(prepare);
  await expectNoSidewaysScroll(page);
  await prepare.getByRole('button', { name: 'Préparer le message' }).click();
  const editor = page.getByTestId('newsletter-editor');
  await expect(editor).toHaveAttribute('data-ready', 'true');
  await expectNoSidewaysScroll(page);

  // « Français · English »: one language at a time in each section.
  const thisWeek = page.getByTestId('newsletter-section-thisWeek');
  const tabs = thisWeek.getByRole('group', { name: 'Langue des paragraphes' });
  await expect(tabs.getByRole('button', { name: 'Français' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const item = thisWeek.getByTestId('newsletter-item').first();
  await expect(item.getByLabel('Français')).toBeVisible();
  await expect(item.getByLabel('English')).toBeHidden();
  await tabs.getByRole('button', { name: 'English' }).click();
  await expect(item.getByLabel('English')).toBeVisible();
  await expect(item.getByLabel('Français')).toBeHidden();
  await expect(item.getByLabel('English')).toHaveValue(/^(French|Mathematics) \(unit “/);
  // Other sections keep their own choice.
  await expect(
    page
      .getByTestId('newsletter-section-message')
      .getByTestId('newsletter-item')
      .getByLabel('Français'),
  ).toBeVisible();
  await expectTargets(thisWeek);
  await expectTargets(page.getByTestId('newsletter-save-bar'));
  // « Partager »: copying and printing (D-141), one tap each.
  await expectTargets(editor.getByRole('group', { name: 'Copier' }));
  await expectTargets(editor.getByRole('group', { name: 'Imprimer (PDF)' }));
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);

  // Back to the list: the message is there.
  await page.getByRole('link', { name: 'Tous les messages' }).click();
  await page.waitForURL(/\/info-parents$/);
  await expect(page.getByRole('link', { name: /^Semaine du / })).toHaveCount(1);
  await expectTargets(page.locator('main ul'));
  await expectNoSidewaysScroll(page);
});
