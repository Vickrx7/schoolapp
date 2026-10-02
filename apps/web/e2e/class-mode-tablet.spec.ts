import { expect, test, type Page } from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems } from './db';
import {
  BATTLE,
  cleanupSessions,
  clearJoinFailures,
  closeClassModeDb,
  controlAs,
  insertBattleQuiz,
  startSessionAs,
} from './db-class-mode';
import { DEMO, e2ePrefix, expectAccessible } from './helpers';

/**
 * Class devices (Phase 5, DECISIONS D-084, D-088, D-090), in the `tablet` project (Chrome on a
 * Galaxy Tab S4, 712×1138) and at Chromebook size (1366×768, no touch): « Rejoindre la partie »
 * is accessible, 64 px tall and never scrolls sideways; a wrong code says so, and eleven quick
 * wrong codes from one device give « Trop d’essais… »; a question is in 22 px type or more; the
 * short answer turns off autocomplete and spell check, and nothing is left in the browser's
 * storage; the screens stay French whatever the device's language cookie.
 *
 * The teacher's side is played in the database as Isabelle (`startSessionAs`, `controlAs`).
 */

const PREFIX = e2ePrefix('T');
const QUIZ = `${PREFIX} Quiz pour tablettes`;
let quizId = '';

test.beforeAll(async () => {
  await clearJoinFailures();
  await cleanupSessions(SEED.class3, {});
  quizId = await insertBattleQuiz({
    author: DEMO.teacher3,
    title: QUIZ,
    sentinel: `SENTINELLE-CORRIGE-${PREFIX}`,
  });
});

test.afterAll(async () => {
  await cleanupSessions(SEED.class3, { itemIds: [quizId] });
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await clearJoinFailures();
  await closeClassModeDb();
  await closeDb();
});

async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function joinWithCode(page: Page, code: string) {
  const join = page.getByRole('button', { name: 'Rejoindre' });
  await expect(join).toBeEnabled();
  await page.getByLabel('Code de la partie').fill(code);
  await join.click();
}

test('« Rejoindre la partie » is big, accessible, French, and throttles wrong codes', async ({
  page,
  context,
}) => {
  // The device's language cookie says English: the student screens stay French (D-090).
  await context.addCookies([
    { name: 'locale', value: 'en-CA', url: test.info().project.use.baseURL! },
  ]);
  await page.goto('/jouer');
  await expect(
    page.getByRole('heading', { name: 'Rejoindre la partie', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  await expect(page.getByText('Join the game')).toHaveCount(0);
  const join = page.getByRole('button', { name: 'Rejoindre' });
  const box = await join.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(64);
  const field = page.getByLabel('Code de la partie');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  await expect(field).toHaveAttribute('spellcheck', 'false');
  await noSidewaysScroll(page);
  await expectAccessible(page);

  // A code nobody uses.
  await joinWithCode(page, 'ACD EFH');
  await expect(page.getByText('Ce code ne fonctionne pas. Vérifie-le au tableau.')).toBeVisible();
  await expectAccessible(page);

  // Ten more wrong codes from this device: the eleventh attempt must wait.
  const codes = [
    'ACDEFJ',
    'ACDEFK',
    'ACDEFM',
    'ACDEFN',
    'ACDEFP',
    'ACDEFR',
    'ACDEFT',
    'ACDEFU',
    'ACDEFV',
    'ACDEFW',
  ];
  for (const code of codes) {
    await joinWithCode(page, code);
    await expect(
      page
        .getByText('Ce code ne fonctionne pas. Vérifie-le au tableau.')
        .or(page.getByText(/^Trop d’essais\. Réessaie dans \d+ secondes?\.$/)),
    ).toBeVisible();
  }
  await expect(page.getByText(/^Trop d’essais\. Réessaie dans \d+ secondes?\.$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rejoindre' })).toBeDisabled();
});

test('a question is big and nothing typed stays on the device', async ({ page }) => {
  await clearJoinFailures();
  const { sessionId, code } = await startSessionAs(DEMO.teacher3, { itemId: quizId, mode: 'solo' });
  await page.goto('/jouer');
  await joinWithCode(page, code.toLowerCase());
  await page.waitForURL(/\/jouer\/partie$/);
  await expect(page.getByRole('heading', { name: 'Tu es l’appareil 1.' })).toBeVisible();
  await expectAccessible(page);

  // Question 1: the prompt is 22 px or more; the choices are 64 px or more.
  await controlAs(DEMO.teacher3, sessionId, 'next');
  const prompt = page.getByText(BATTLE.q1.prompt);
  await expect(prompt).toBeVisible();
  const size = await prompt.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(22);
  const choice = page.getByRole('button', { name: `Réponse A : 990`, exact: true });
  expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await noSidewaysScroll(page);
  await expectAccessible(page);

  // Question 5, the short answer: no autocomplete, autocorrect or spell check.
  for (let i = 0; i < 4; i++) {
    await controlAs(DEMO.teacher3, sessionId, 'reveal');
    await controlAs(DEMO.teacher3, sessionId, 'next');
  }
  const field = page.getByLabel('Ta réponse');
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('autocomplete', 'off');
  await expect(field).toHaveAttribute('autocorrect', 'off');
  await expect(field).toHaveAttribute('autocapitalize', 'off');
  await expect(field).toHaveAttribute('spellcheck', 'false');
  await field.fill('reponse-libre-xyz');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByText('Réponse envoyée!')).toBeVisible();
  await expectAccessible(page);

  // Nothing typed is kept in the browser's storage (D-088).
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test.describe('on a Chromebook', () => {
  test.use({ viewport: { width: 1366, height: 768 }, hasTouch: false, isMobile: false });

  test('« Rejoindre la partie » and the lobby fit and pass axe', async ({ page }) => {
    await clearJoinFailures();
    const { code } = await startSessionAs(DEMO.teacher3, { itemId: quizId, teams: 3 });
    await page.goto('/jouer');
    await noSidewaysScroll(page);
    await expectAccessible(page);
    await joinWithCode(page, code);
    await page.waitForURL(/\/jouer\/partie$/);
    await expect(page.getByText(/^Ton équipe\s: Les /)).toBeVisible();
    await noSidewaysScroll(page);
    await expectAccessible(page);
  });
});
