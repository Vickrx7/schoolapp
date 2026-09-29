import { expect, test, type Page } from '@playwright/test';
import { cleanupAbsences, closeDb, nextLesson, SEED } from './db';
import { DEMO, expectAccessible, login, reportAbsence, schoolDay } from './helpers';

// Substitute plans use library resources (DECISIONS D-077). Isabelle's next Français lesson
// (« Trouver l'idée principale ») shares the attente C1.2 with the board-approved « Le huard,
// oiseau des lacs », which has a version per language level. Publishing builds the plan in the
// request, so no worker is needed.
test.describe.configure({ mode: 'serial' });

const HUARD = 'Le huard, oiseau des lacs';
/** The Débutant version starts this way; the other versions do not. */
const HUARD_DEBUTANT = 'Le huard est un grand oiseau. Il vit sur les lacs.';
/** Words of the huard's answer key (explanations), which must never reach a plan. */
const HUARD_KEY = ['Réponse par inférence', 'Détails possibles : tête et cou noirs'];
const HUARD_ID = '3daed963-c2a5-568d-b23e-b38865b2b551';

test.beforeAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
});

test.afterAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await closeDb();
});

/** The plan's first Français period (the lesson that uses the huard). */
function frenchBlock(page: Page, title: string) {
  return page.getByTestId('plan-block').filter({ hasText: title }).first();
}

test('a Thursday plan uses the huard, with each group’s version and no key', async ({ page }) => {
  test.setTimeout(90_000);
  const french = await nextLesson(SEED.class3, 'fra');
  // The seed's next Français lesson (4, « Trouver l'idée principale ») is linked to C1.2.
  expect(french.sequenceNumber).toBe(4);
  const thursday = schoolDay({ weeksAhead: 4, isoWeekday: 4 });

  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: thursday });
  await page.getByRole('link', { name: 'Réviser le plan' }).first().click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
  const planUrl = page.url();

  // The Français period shows the resource and the step that sends the substitute to it.
  const block = frenchBlock(page, french.title);
  const library = block.getByTestId('plan-library');
  await expect(library).toContainText(`Ressource de la banque : ${HUARD}`);
  await expect(library).toContainText('Approuvée par le conseil');
  await expect(block).toContainText(`Distribuez « ${HUARD} » : voir « Matériel pour les élèves ».`);

  // « Matériel pour les élèves »: one version per group; the Débutant group gets its text.
  await expect(library.getByRole('heading', { name: 'Matériel pour les élèves' })).toBeVisible();
  const groups = library.getByTestId('plan-library-group');
  await expect(groups).toHaveCount(4);
  const debutants = groups.filter({ hasText: 'Débutant' });
  await expect(debutants).toContainText('Samuel');
  await debutants.locator('summary').click();
  await expect(debutants).toContainText(HUARD_DEBUTANT);
  const avances = groups.filter({ hasText: 'Avancé' });
  await avances.locator('summary').click();
  await expect(avances).not.toContainText(HUARD_DEBUTANT);
  await expect(library).toContainText(
    'Le corrigé reste avec l’enseignant·e : ramassez les feuilles.',
  );
  await library.getByText('Guide de la ressource').click();
  await expectAccessible(page);

  // No key anywhere in the plan, folded parts included; « Voir le corrigé » opens the resource
  // (its teacher tab).
  const planText = (await page.locator('main').textContent()) ?? '';
  for (const words of HUARD_KEY) expect(planText).not.toContain(words);
  const seeKey = library.getByRole('link', { name: 'Voir le corrigé' });
  await expect(seeKey).toHaveAttribute('href', `/library/items/${HUARD_ID}?tab=teacher`);

  // The plan PDF (the resource's guide, no key) and the students' pages both render.
  const pdf = await page.request.get(`${planUrl}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const sheets = page.getByTestId('activity-sheets-pdf');
  await expect(sheets).toHaveText('Activités pour les élèves (PDF)');
  const students = await page.request.get((await sheets.getAttribute('href'))!);
  expect(students.status()).toBe(200);
  expect(students.headers()['content-type']).toBe('application/pdf');
  expect((await students.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

  await seeKey.click();
  await page.waitForURL(new RegExp(`/library/items/${HUARD_ID}\\?tab=teacher$`));
  await expect(page.getByRole('heading', { level: 1, name: HUARD })).toBeVisible();

  // « Ne pas utiliser cette ressource »: saved with her edits, still hidden after a reload.
  await page.goto(planUrl);
  const hide = frenchBlock(page, french.title).getByRole('button', {
    name: 'Ne pas utiliser cette ressource',
  });
  const hidden = frenchBlock(page, french.title).getByTestId('plan-library-hidden');
  // A tap before the page is interactive is lost: retry until the resource is hidden.
  await expect(async () => {
    if (!(await hidden.isVisible())) await hide.click();
    await expect(hidden).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByTestId('plan-save-status')).toContainText('Enregistré à', {
    timeout: 15_000,
  });
  await page.reload();
  const reloaded = frenchBlock(page, french.title);
  await expect(reloaded.getByTestId('plan-library-hidden')).toContainText(HUARD);
  await expect(reloaded.getByTestId('plan-library')).toHaveCount(0);
  await expect(reloaded).not.toContainText('Distribuez « Le huard');
  await expect(reloaded.getByRole('button', { name: 'Utiliser cette ressource' })).toBeVisible();
  await expectAccessible(page);
});
