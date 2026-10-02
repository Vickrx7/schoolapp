import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems } from './db';
import {
  BATTLE,
  classLink,
  classModeCounts,
  cleanupSessions,
  clearJoinFailures,
  closeClassModeDb,
  controlAs,
  insertBattleQuiz,
  openSession,
  startSessionAs,
} from './db-class-mode';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Quiz sur les appareils » (Phase 5, DECISIONS D-084 to D-090): Isabelle starts a team quiz
 * from a resource's page; two tablets join, one with the class link (it joins by itself) and one
 * with the code typed in lowercase with a space; a third device is refused once the game started.
 * Every question kind is played; after « Afficher la réponse » a device learns only its own
 * result. « Terminer la séance » deletes every answer and device. No response a tablet receives
 * holds a key (sentinels in every key field, the teacher's note and fields a whitelist must drop),
 * and the device pages carry only the student messages. A second session hides answers and keeps
 * the class results; a colleague's open session can be ended and replaced.
 *
 * The quiz is written here (`insertBattleQuiz`, the pgTAP fixture's shape); the sessions, the
 * quiz and the join failures are removed afterwards.
 */

const PREFIX = e2ePrefix('Q');
const QUIZ = `${PREFIX} Bataille des nombres`;
const SENTINEL = `SENTINELLE-CORRIGE-${PREFIX}`;
/** The seeded demo quiz a colleague plays (board-approved). */
const DEMO_QUIZ = '7bdc7066-9b8a-5125-8351-bf234b0b11d3';
/** Key fields no device API body may contain (D-086). */
const KEY_FIELDS = ['correctChoiceIds', 'orderedIds', 'acceptable', 'sampleAnswer', 'explanation'];

let quizId = '';
const madeSessions: string[] = [];

test.beforeAll(async () => {
  await clearJoinFailures();
  await cleanupSessions(SEED.class3, {});
  quizId = await insertBattleQuiz({ author: DEMO.teacher3, title: QUIZ, sentinel: SENTINEL });
});

test.afterAll(async () => {
  await cleanupSessions(SEED.class3, { itemIds: [quizId], sessionIds: madeSessions });
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await clearJoinFailures();
  await closeClassModeDb();
  await closeDb();
});

/** A class tablet (Chrome on an Android tablet: only Chromium is installed here). */
async function tablet(browser: Browser): Promise<BrowserContext> {
  const use = test.info().project.use;
  return browser.newContext({
    ...devices['Galaxy Tab S4'],
    baseURL: use.baseURL,
    locale: 'fr-CA',
    timezoneId: use.timezoneId,
  });
}

/** Every response body a page receives, with its address (for the key leak checks). */
function recordBodies(page: Page): { url: string; body: string }[] {
  const bodies: { url: string; body: string }[] = [];
  page.on('response', (response) => {
    void response
      .text()
      .then((body) => bodies.push({ url: response.url(), body }))
      .catch(() => undefined);
  });
  return bodies;
}

/** Clicks, retrying until `then` shows (a tap before hydration is lost). */
async function clickUntil(button: Locator, then: Locator) {
  await expect(async () => {
    if (!(await then.isVisible())) await button.click();
    await expect(then).toBeVisible({ timeout: 1500 });
  }).toPass();
}

/** « Lancer un quiz sur les appareils » on the quiz's page; returns the dialog. */
async function openStartDialog(page: Page): Promise<Locator> {
  await page.goto(`/library/items/${quizId}`);
  const dialog = page.getByRole('dialog', { name: 'Lancer un quiz sur les appareils' });
  await clickUntil(page.getByRole('button', { name: 'Lancer un quiz sur les appareils' }), dialog);
  return dialog;
}

const chip = (scope: Locator, name: string) =>
  scope.locator('label').filter({ hasText: new RegExp(`^${name}$`) });

/** Joins a tablet with a typed code. */
async function joinWithCode(page: Page, code: string) {
  await page.goto('/jouer');
  const field = page.getByLabel('Code de la partie');
  await expect(page.getByRole('button', { name: 'Rejoindre' })).toBeEnabled();
  await field.fill(code);
  await page.getByRole('button', { name: 'Rejoindre' }).click();
}

const projectorHeading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 2, name });

test('a team quiz on two tablets: join, play every kind, answers shown, end deletes it all', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page, DEMO.teacher3);

  // 1. « Lancer un quiz sur les appareils »: 3e année, 2 teams, no timer.
  const dialog = await openStartDialog(page);
  await expect(dialog.getByLabel('Classe')).toHaveValue(SEED.class3);
  await expect(chip(dialog, 'En équipes').locator('input')).toBeChecked();
  await chip(dialog, '2').click();
  await expect(chip(dialog, 'Sans minuterie').locator('input')).toBeChecked();
  await expect(dialog.getByLabel('Montrer la bonne réponse après chaque question')).toBeChecked();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Lancer', exact: true }).click();
  // No first name of the class in the quiz: it starts at once, on the projector.
  await page.waitForURL(/\/projector\/sessions\/[0-9a-f-]{36}$/);
  const sessionId = /sessions\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  madeSessions.push(sessionId);

  await expect(page.getByRole('heading', { name: 'Rejoignez la partie' })).toBeVisible();
  const code = (await page.locator('[data-join-code]').getAttribute('data-join-code'))!;
  expect(code).toMatch(/^[ACDEFHJKMNPRTUVWXY3479]{6}$/);
  // In two groups of three, in big type.
  await expect(page.locator('[data-join-code] > span[aria-hidden]')).toHaveText([
    code.slice(0, 3),
    code.slice(3),
  ]);
  await expect(page.getByRole('img', { name: 'Code QR du lien de la classe' })).toBeVisible();
  await expect(page.getByText('Aucun appareil', { exact: true }).first()).toBeVisible();
  await expectAccessible(page);

  // 2. Tablet A opens the class link and joins by itself; tablet B types the code.
  const token = await classLink(SEED.class3);
  const contexts = [await tablet(browser), await tablet(browser)];
  try {
    const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
    const bodiesA = recordBodies(a!);
    const bodiesB = recordBodies(b!);
    await a!.goto(`/jouer#k=${token}`);
    await a!.waitForURL(/\/jouer\/partie$/);
    await joinWithCode(b!, `${code.slice(0, 3).toLowerCase()} ${code.slice(3).toLowerCase()}`);
    await b!.waitForURL(/\/jouer\/partie$/);
    for (const device of [a!, b!]) {
      await expect(
        device.getByRole('heading', { name: /^Tu es l’appareil [12]\.$/ }),
      ).toBeVisible();
      await expect(device.getByText(/^Ton équipe\s: Les (Huards|Castors)$/)).toBeVisible();
      await expect(device.getByText('Regarde l’écran : la partie va commencer.')).toBeVisible();
    }
    await expectAccessible(a!);
    // One device per team tile (teams are balanced).
    await expect(page.getByText('1 appareil', { exact: true })).toHaveCount(2);

    // 3. « Commencer » closes joining: a third device is refused.
    await page.getByRole('button', { name: 'Commencer' }).click();
    await expect(projectorHeading(page, 'Question 1 sur 5')).toBeVisible();
    const late = await tablet(browser);
    contexts.push(late);
    const c = await late.newPage();
    await joinWithCode(c, code);
    await expect(
      c.getByText('Les inscriptions sont fermées. Demande à ton enseignant·e.'),
    ).toBeVisible();

    // Question 1 (multiple choice): A right, B wrong.
    await expect(a!.getByText(BATTLE.q1.prompt)).toBeVisible();
    await expect(a!.getByText(BATTLE.q1.prompt)).toHaveCSS(
      'font-size',
      /^(2[2-9]|[3-9]\d)(\.\d+)?px$/,
    );
    await expectAccessible(a!);
    await a!.getByRole('button', { name: `Réponse B : ${BATTLE.q1.right}`, exact: true }).click();
    await b!.getByRole('button', { name: `Réponse C : ${BATTLE.q1.wrong}`, exact: true }).click();
    for (const device of [a!, b!]) await expect(device.getByText('Réponse envoyée!')).toBeVisible();
    await expect(page.getByText('2 réponses sur 2')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Afficher la réponse' }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: BATTLE.q1.right }).first(),
    ).toContainText('Bonne réponse');
    await expect(a!.getByText('Bonne réponse!')).toBeVisible();
    await expect(a!.getByText('+100 points')).toBeVisible();
    await expect(b!.getByText('Pas cette fois.')).toBeVisible();
    await expect(b!.getByText('Regarde l’écran pour la bonne réponse.')).toBeVisible();
    // The device never shows the right answer: no choice is marked on B.
    await expect(b!.getByText('Bonne réponse', { exact: true })).toHaveCount(0);
    await expect(b!.getByText(BATTLE.q1.right, { exact: true })).toHaveCount(0);
    await expectAccessible(page);

    // Question 2 (true or false).
    await page.getByRole('button', { name: 'Question suivante' }).click();
    await expect(projectorHeading(page, 'Question 2 sur 5')).toBeVisible();
    await a!.getByRole('button', { name: 'Vrai', exact: true }).click();
    await b!.getByRole('button', { name: 'Faux', exact: true }).click();
    await expect(page.getByText('2 réponses sur 2')).toBeVisible();
    await page.getByRole('button', { name: 'Afficher la réponse' }).click();
    await expect(a!.getByText('Bonne réponse!')).toBeVisible();

    // Question 3 (matching, native lists).
    await page.getByRole('button', { name: 'Question suivante' }).click();
    await expect(projectorHeading(page, 'Question 3 sur 5')).toBeVisible();
    for (const device of [a!, b!]) {
      // By accessible name: each list's label also holds its number, hidden from screen readers.
      const list = (name: string) => device.getByRole('combobox', { name, exact: true });
      await list('cent').selectOption({ label: '100' });
      await list('mille').selectOption({ label: '1 000' });
      await list('dix').selectOption({ label: '10' });
      await device.getByRole('button', { name: 'Envoyer' }).click();
      await expect(device.getByText('Réponse envoyée!')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Afficher la réponse' }).click();
    await expect(page.getByText('Bonnes associations')).toBeVisible();

    // Question 4 (ordering): « 100 » moves up twice on A.
    await page.getByRole('button', { name: 'Question suivante' }).click();
    await expect(projectorHeading(page, 'Question 4 sur 5')).toBeVisible();
    await a!.getByRole('button', { name: 'Monter « 100 »' }).click();
    await a!.getByRole('button', { name: 'Monter « 100 »' }).click();
    await a!.getByRole('button', { name: 'Envoyer' }).click();
    await b!.getByRole('button', { name: 'Envoyer' }).click();
    await expect(page.getByText('2 réponses sur 2')).toBeVisible();
    await page.getByRole('button', { name: 'Afficher la réponse' }).click();
    await expect(a!.getByText('Bonne réponse!')).toBeVisible();

    // Question 5 (short answer): recorded, not scored by default.
    await page.getByRole('button', { name: 'Question suivante' }).click();
    await expect(projectorHeading(page, 'Question 5 sur 5')).toBeVisible();
    const field = a!.getByLabel('Ta réponse');
    await expect(field).toHaveAttribute('autocomplete', 'off');
    await expect(field).toHaveAttribute('spellcheck', 'false');
    await field.fill('1 000');
    await a!.getByRole('button', { name: 'Envoyer' }).click();
    await expect(a!.getByText('Réponse envoyée!')).toBeVisible();
    await page.getByRole('button', { name: 'Afficher la réponse' }).click();
    await expect(a!.getByText('Réponse enregistrée')).toBeVisible();

    // « Classement » everywhere.
    await page.getByRole('button', { name: 'Classement' }).click();
    await expect(page.getByRole('heading', { name: 'Classement des équipes' })).toBeVisible();
    for (const device of [a!, b!]) {
      await expect(device.getByRole('heading', { name: 'Classement des équipes' })).toBeVisible();
    }
    await expectAccessible(page);

    // 5. « Terminer », then « Terminer la séance » without keeping results.
    await page.getByRole('button', { name: 'Terminer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Partie terminée' })).toBeVisible();
    await expect(a!.getByRole('heading', { name: 'La partie est terminée. Merci!' })).toBeVisible();
    await page.getByRole('button', { name: 'Terminer la séance' }).click();
    const end = page.getByRole('dialog', { name: 'Terminer la séance' });
    await expect(end.getByText('Les réponses des élèves seront effacées.')).toBeVisible();
    await expect(end.getByLabel('Garder les résultats de la classe (sans noms)')).not.toBeChecked();
    await expectAccessible(page);
    await end.getByRole('button', { name: 'Terminer la séance' }).click();
    await page.waitForURL(new RegExp(`/classes/${SEED.class3}/class-mode$`));
    for (const device of [a!, b!]) {
      await expect(device.getByText('Cette partie est terminée pour toi. Merci!')).toBeVisible();
    }
    expect(await classModeCounts(sessionId)).toEqual({ participants: 0, responses: 0, results: 0 });

    // 6. No key ever reached a tablet, and the device pages carry only the student messages.
    for (const bodies of [bodiesA, bodiesB]) {
      for (const { url, body } of bodies) {
        expect(body, url).not.toContain(SENTINEL);
        if (new URL(url).pathname.startsWith('/jouer/api/')) {
          for (const field of KEY_FIELDS) expect(body, `${url}: ${field}`).not.toContain(field);
        }
        if (/\/jouer(\/partie)?(\?|$)/.test(new URL(url).pathname + new URL(url).search)) {
          expect(body, url).not.toContain('"classMode"');
          expect(body, url).not.toContain('"libraryItem"');
        }
      }
    }
    const html = await (await a!.request.get('/jouer')).text();
    expect(html).not.toContain('"classMode"');
    expect(html).not.toContain('"library');
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test('answers hidden: devices learn nothing until the end; kept class results', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page, DEMO.teacher3);
  const dialog = await openStartDialog(page);
  await chip(dialog, 'Chacun pour soi').click();
  await dialog.getByLabel('Montrer la bonne réponse après chaque question').uncheck();
  await dialog.getByRole('button', { name: 'Lancer', exact: true }).click();
  await page.waitForURL(/\/projector\/sessions\/[0-9a-f-]{36}$/);
  const sessionId = /sessions\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  madeSessions.push(sessionId);
  const code = (await page.locator('[data-join-code]').getAttribute('data-join-code'))!;

  const context = await tablet(browser);
  try {
    const device = await context.newPage();
    await joinWithCode(device, code);
    await device.waitForURL(/\/jouer\/partie$/);
    await expect(device.getByRole('heading', { name: 'Tu es l’appareil 1.' })).toBeVisible();

    await page.getByRole('button', { name: 'Commencer' }).click();
    await device
      .getByRole('button', { name: `Réponse B : ${BATTLE.q1.right}`, exact: true })
      .click();
    await expect(page.getByText('1 réponse sur 1')).toBeVisible();
    await page.getByRole('button', { name: 'Afficher la réponse' }).click();
    // Only « Réponse enregistrée »; the projector shows the answers but not which is right,
    // nor how many were right (beside the per-choice counts, that would name it).
    await expect(device.getByText('Réponse enregistrée')).toBeVisible();
    await expect(device.getByText('Bonne réponse!')).toHaveCount(0);
    await expect(
      page.getByText('Les bonnes réponses ne sont pas montrées pendant cette séance.'),
    ).toBeVisible();
    await expect(page.getByText(/bonnes? réponses? sur/)).toHaveCount(0);
    await expect(page.locator('[data-correct]')).toHaveCount(0);
    // The ranking waits for the last question.
    await expect(page.getByRole('button', { name: 'Classement' })).toBeDisabled();
    for (let n = 2; n <= 5; n++) {
      await page.getByRole('button', { name: 'Question suivante' }).click();
      await expect(projectorHeading(page, `Question ${n} sur 5`)).toBeVisible();
      await page.getByRole('button', { name: 'Afficher la réponse' }).click();
      await expect(page.getByRole('button', { name: 'Afficher la réponse' })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Classement' })).toBeEnabled();
    await page.getByRole('button', { name: 'Classement' }).click();
    await expect(page.getByRole('heading', { name: 'Résultats de la classe' })).toBeVisible();

    // At the end the device learns its own total (answers were hidden).
    await page.getByRole('button', { name: 'Terminer', exact: true }).click();
    await expect(device.getByText(/^Ton total\s: \d+ points?$/)).toBeVisible();

    // Keep the class results.
    await page.getByRole('button', { name: 'Terminer la séance' }).click();
    const end = page.getByRole('dialog', { name: 'Terminer la séance' });
    await end.getByLabel('Garder les résultats de la classe (sans noms)').check();
    await end.getByRole('button', { name: 'Terminer la séance' }).click();
    await page.waitForURL(new RegExp(`/classes/${SEED.class3}/class-mode$`));
    expect(await classModeCounts(sessionId)).toEqual({ participants: 0, responses: 0, results: 1 });

    // « Résultats gardés »: the per-question figures, then « Supprimer ».
    await expect(page.getByRole('heading', { name: 'Résultats gardés' })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(QUIZ) }).click();
    await page.waitForURL(new RegExp(`/class-mode/results/${sessionId}$`));
    await expect(page.getByRole('heading', { name: QUIZ })).toBeVisible();
    await expect(page.getByText(/% de bonnes réponses$/).first()).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await page.waitForURL(new RegExp(`/classes/${SEED.class3}/class-mode$`));
    expect(await classModeCounts(sessionId)).toEqual({ participants: 0, responses: 0, results: 0 });
  } finally {
    await context.close();
  }
});

/** Common classroom screens: projectors and laptops (16:9, 16:10 and 4:3). */
const SCREENS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
];

test('the projector fits common classroom screens: six teams, and the right answer readable', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { sessionId } = await startSessionAs(DEMO.teacher3, { itemId: quizId, teams: 6 });
  madeSessions.push(sessionId);
  await login(page, DEMO.teacher3);
  const region = page.getByRole('region', { name: 'Écran de la classe' });

  // The lobby: six team tiles, each name inside its tile, all of them on screen.
  for (const screen of SCREENS) {
    await page.setViewportSize(screen);
    await page.goto(`/projector/sessions/${sessionId}`);
    await expect(page.getByRole('heading', { name: 'Rejoignez la partie' })).toBeVisible();
    await expect(page.getByText('Les Renards', { exact: true })).toBeVisible();
    const fit = await page.evaluate(() => {
      const scroller = document.querySelector('[role="region"][tabindex="0"]')!;
      const bottom = scroller.getBoundingClientRect().bottom;
      const tiles = [...scroller.querySelectorAll('li')];
      return {
        tiles: tiles.length,
        spilling: tiles.filter((li) => li.scrollWidth > li.clientWidth + 1).length,
        below: tiles.filter((li) => li.getBoundingClientRect().bottom > bottom + 1).length,
        pageScroll: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(fit, `${screen.width}×${screen.height}`).toEqual({
      tiles: 6,
      spilling: 0,
      below: 0,
      pageScroll: false,
    });
  }
  await expectAccessible(page);

  // « Appareils »: the teacher's list (projected only when she opens it), « 0 connecté sur 0 ».
  const panel = page.getByRole('dialog', { name: 'Appareils' });
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Appareils (0)' }).click();
    }
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(panel.getByText('0 connecté sur 0', { exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // « Afficher la réponse »: the right choice's text keeps a readable width, on screen, with its
  // « Bonne réponse » on its own line.
  await controlAs(DEMO.teacher3, sessionId, 'next');
  await controlAs(DEMO.teacher3, sessionId, 'reveal');
  for (const screen of SCREENS) {
    await page.setViewportSize(screen);
    await page.goto(`/projector/sessions/${sessionId}`);
    const correct = page.locator('[data-correct]');
    await expect(correct).toContainText('Bonne réponse');
    // « 1 000 » on one line (squeezed beside the label, it once broke into a letter a line).
    const lines = await correct.locator('span[lang]').evaluate((span) => {
      const box = span.getBoundingClientRect();
      return box.height / parseFloat(getComputedStyle(span).lineHeight);
    });
    expect(lines, `${screen.width}×${screen.height}`).toBeLessThan(1.5);
    await expect(correct).toBeInViewport();
    // The answer count is projector type (40 px at 1920 × 1080), beside « Question 1 sur 5 ».
    const counter = page.getByText('0 réponse sur 0', { exact: true });
    await expect(counter).toBeVisible();
    if (screen.width === 1920) await expect(counter).toHaveCSS('font-size', '40px');
  }
  // The screen's scrolling region is reachable from the keyboard.
  await expect(region).toHaveAttribute('tabindex', '0');
  await expectAccessible(page);
});

test('a colleague’s open session can be ended and replaced', async ({ page }) => {
  // Paul Leblanc, also on the 3e année's team, left a session open.
  const colleague = await startSessionAs(DEMO.rotary, { itemId: DEMO_QUIZ, replaceOpen: true });
  madeSessions.push(colleague.sessionId);
  await login(page, DEMO.teacher3);

  // The class tab shows it, with « Reprendre la projection ».
  await page.goto(`/classes/${SEED.class3}/class-mode`);
  await expect(page.getByRole('heading', { name: 'Séance en cours' })).toBeVisible();
  await expect(page.getByText(/lancée par M\. Leblanc/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reprendre la projection' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lien de la classe' })).toBeVisible();
  await expectAccessible(page);

  const dialog = await openStartDialog(page);
  await dialog.getByRole('button', { name: 'Lancer', exact: true }).click();
  await expect(dialog.getByText('Une séance est déjà en cours pour cette classe.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Terminer cette séance et lancer' }).click();
  await page.waitForURL(/\/projector\/sessions\/[0-9a-f-]{36}$/);
  const sessionId = /sessions\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  madeSessions.push(sessionId);
  expect(sessionId).not.toBe(colleague.sessionId);
  expect(await openSession(SEED.class3)).toBe(sessionId);
  // The colleague's session ended: its answers and devices are gone.
  expect(await classModeCounts(colleague.sessionId)).toEqual({
    participants: 0,
    responses: 0,
    results: 0,
  });
});
