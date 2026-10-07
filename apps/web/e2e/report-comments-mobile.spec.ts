import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb, query } from './db';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Bulletins » on a phone (DECISIONS D-130), 360 × 740: the students' list, then one student on
 * a screen of its own (the address's fragment, so Back returns to the list), every target at
 * least 44 px, and no sideways scroll. Nothing is kept: the comment made here stays in this test's
 * browser, which is thrown away.
 */
test.use({ viewport: { width: 360, height: 740 } });

test.afterAll(closeDb);

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

/** Every visible control in `region` is at least 44 px high (labels stand for their boxes). */
async function expectTargets(region: Locator) {
  const targets = region.locator(
    'a, button, select, textarea, summary, input:not([type=radio]):not([type=checkbox]), label:has(input[type=radio]), label:has(input[type=checkbox])',
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

test('« Bulletins » on a phone: the list, one student, Back to the list, 44 px targets', async ({
  page,
}) => {
  const [math] = await query<{ id: string }>(
    "select id from public.subjects where code = 'mat' and board_id is null",
  );
  await login(page, DEMO.teacher3);
  await page.goto(`/classes/${SEED.class3}/bulletins?period=term1&subject=${math!.id}`);
  await expect(page.getByTestId('device-notice')).toContainText(
    'Vos commentaires restent sur cet appareil.',
  );
  const list = page.getByRole('navigation', { name: /^Élèves/ });
  await expect(list).toBeVisible();
  // The class's tabs: « Bulletins » scrolled into view, an arrow says more tabs are to its left.
  const tab = page
    .getByRole('navigation', { name: 'Aperçu' })
    .getByRole('link', { name: 'Bulletins' });
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(tab).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('class-tabs-more-before')).toBeVisible();
  // The list is its own screen: no student is open yet.
  await expect(page.getByRole('article')).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await expectTargets(list);
  await expectTargets(page.locator('form'));
  await expectAccessible(page);

  await list.getByRole('link', { name: /^Chloé\s/ }).click();
  await expect(page).toHaveURL(/#eleve-[0-9a-f-]{36}$/);
  await expect(list).toBeHidden();
  const editor = page.getByRole('article');
  await expect(editor.getByRole('heading', { level: 3, name: /^Chloé/ })).toBeVisible();
  await editor.getByRole('radio', { name: 'Niveau 3' }).check();
  await editor
    .getByRole('group', { name: 'Points forts' })
    .getByRole('checkbox', { name: /^Chloé lit, représente, compose/ })
    .check();
  await expect(editor.getByLabel('Commentaire', { exact: true })).toHaveValue(/^Chloé lit, /);
  await expect(editor.getByText(/^\d+\s\/\s1\s000\scaractères$/)).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectTargets(editor);
  await expectAccessible(page);

  // Back: the list again, with her status.
  await page.goBack();
  await expect(list).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(list.getByRole('link', { name: /^Chloé\sPrêt\s·\s\d+\s\/\s1\s000$/ })).toBeVisible();

  // « Tous les élèves » does the same.
  await list.getByRole('link', { name: /^Chloé\s/ }).click();
  await page.getByRole('article').getByRole('link', { name: 'Tous les élèves' }).click();
  await expect(list).toBeVisible();
  await expect(page).not.toHaveURL(/#eleve-/);
  await expectNoSidewaysScroll(page);
  await expectTargets(page.locator('section').filter({ hasText: 'Réglages et impression' }));
});
