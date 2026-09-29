import { seedItemId } from '@lynx/content';
import { expect, test, type Page, type Response } from '@playwright/test';
import { closeDb, deleteLibraryItems, insertReadyItem, query, resetLanguage } from './db';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Présenter à la classe » (Phase 5, DECISIONS D-082, D-086, D-090): the projector player for a
 * brain break, an experiment and a quiz. The projected page carries only the slides: no answer
 * key (planted sentinels in every other answer, the solution and the teacher's note), no safety
 * note (sentinels in every field) and no level name, in the HTML or in the React Server
 * Components payload; « Afficher la réponse » fetches one answer when asked. The slide is in the
 * address, the keyboard drives it, and the page needs a landscape screen at least 768 px wide.
 *
 * The quiz and the experiment are written here (`insertReadyItem`); the brain break and the demo
 * experiment are the demo pack's (`content/library/demo`).
 */

const PREFIX = e2ePrefix('P');
const QUIZ = `${PREFIX} Quiz projeté`;
const EXPERIMENT = `${PREFIX} Expérience projetée`;
const KEY_SENTINEL = `SENTINELLE-CORRIGE-${PREFIX}`;
const SAFETY_SENTINEL = `SENTINELLE-SECURITE-${PREFIX}`;
const TEACHER_SENTINEL = `SENTINELLE-ENSEIGNANT-${PREFIX}`;
/** The sample quiz's first question (`sampleCanonical('quiz')`) and its explanation. */
const FIRST_QUESTION = 'Quel nombre est le plus grand?';
const EXPLANATION = '893 a 8 centaines; 389 et 398 en ont seulement 3.';
const NOT_FOUND = 'Cette page n’existe pas ou vous n’y avez pas accès.';
const NARROW = 'Ouvrez cette page sur l’ordinateur branché au projecteur.';

/** « Pause active : le jeu du miroir » and « Éponges et élastiques » (demo pack). */
const MIRROR = seedItemId('demo', 'pause-jeu-du-miroir');
const SPONGES = seedItemId('demo', 'eponges-elastiques');

let quizId = '';
let experimentId = '';
let worksheetId = '';
let draftId = '';

const presenter = (id: string, query = '') => `/projector/items/${id}${query}`;
const slideHeading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 2, name });

/**
 * Goes to a slide with the keyboard once the player is interactive: « Home » then `steps` times
 * →, retried until the heading shows (a key pressed before hydration is lost; « Home » makes a
 * retry start over instead of going further).
 */
async function goToSlide(page: Page, steps: number, heading: string | RegExp) {
  await expect(async () => {
    await page.keyboard.press('Home');
    for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight');
    await expect(slideHeading(page, heading)).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Every response body of the page (HTML, RSC payloads, server actions), for leak checks. */
function recordBodies(page: Page): string[] {
  const bodies: string[] = [];
  page.on('response', (response: Response) => {
    void response
      .text()
      .then((text) => bodies.push(text))
      .catch(() => undefined);
  });
  return bodies;
}

/** The page's HTML (with the inline RSC payload) and its RSC payload fetched on its own. */
async function payloads(page: Page): Promise<string> {
  const rsc = await page.request.get(page.url(), { headers: { RSC: '1' } });
  return `${await page.content()}\n${await rsc.text()}`;
}

test.beforeAll(async () => {
  // A board-approved quiz with the board's levels; a sentinel in the teacher's note of every
  // version and in every answer of the key but the first question's.
  quizId = await insertReadyItem({
    author: null,
    type: 'quiz',
    title: QUIZ,
    status: 'board_approved',
    levels: true,
  });
  const keys = await query<{
    version_id: string;
    answer_key: { answers: Record<string, unknown>[]; solution: string };
  }>(
    `select k.version_id, k.answer_key from public.library_item_answer_keys k
     join public.library_item_versions v on v.id = k.version_id where v.item_id = $1`,
    [quizId],
  );
  for (const key of keys) {
    const planted = {
      ...key.answer_key,
      solution: KEY_SENTINEL,
      answers: key.answer_key.answers.map((entry) =>
        entry.questionId === 'mc1'
          ? entry
          : {
              ...entry,
              explanation: KEY_SENTINEL,
              ...(entry.kind === 'short_answer'
                ? { sampleAnswer: KEY_SENTINEL, acceptableAnswers: [KEY_SENTINEL] }
                : {}),
            },
      ),
    };
    await query(
      `update public.library_item_answer_keys set answer_key = $2::jsonb where version_id = $1`,
      [key.version_id, JSON.stringify(planted)],
    );
  }

  // A board-approved experiment whose safety notes are all sentinels.
  experimentId = await insertReadyItem({
    author: null,
    type: 'experiment',
    title: EXPERIMENT,
    status: 'board_approved',
  });
  await query(
    `update public.library_items set safety_notes = jsonb_build_object(
       'ageSuitability', $2::text, 'allergyAwareMaterials', $2::text, 'supervision', 'standard',
       'hazards', jsonb_build_array($2::text), 'notes', $2::text)
     where id = $1`,
    [experimentId, SAFETY_SENTINEL],
  );
  await query(
    `update public.library_item_answer_keys k
     set answer_key = jsonb_set(k.answer_key, '{solution}', to_jsonb($2::text))
     from public.library_item_versions v where v.id = k.version_id and v.item_id = $1`,
    [experimentId, KEY_SENTINEL],
  );
  for (const id of [quizId, experimentId]) {
    await query(
      `update public.library_item_versions
       set content = jsonb_set(content, '{teacherNote}', to_jsonb($2::text)) where item_id = $1`,
      [id, TEACHER_SENTINEL],
    );
  }

  // Not presentable: a worksheet (no player, not projectable) and a colleague's private draft.
  worksheetId = await insertReadyItem({
    author: null,
    type: 'worksheet',
    title: `${PREFIX} Fiche non projetable`,
    status: 'board_approved',
  });
  draftId = await insertReadyItem({
    author: DEMO.teacher5,
    type: 'quiz',
    title: `${PREFIX} Brouillon de Marc`,
  });
});

test.afterAll(async () => {
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await resetLanguage(DEMO.office);
  await closeDb();
});

test('a brain break shows one step per slide, and the slide is kept in the address', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${MIRROR}`);
  await page.getByRole('link', { name: 'Présenter à la classe' }).click();
  await page.waitForURL(new RegExp(`/projector/items/${MIRROR}\\?v=[0-9a-f-]{36}$`));

  // The title slide first, full screen, without the app's navigation.
  await expect(slideHeading(page, /^Pause active.*le jeu du miroir$/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0);
  await expectAccessible(page);

  // → : « Étape 1 sur N », then « Étape 2 sur N » (slide 3, in the address).
  await goToSlide(page, 1, /^Étape 1 sur \d+$/);
  await page.keyboard.press('ArrowRight');
  const step2 = slideHeading(page, /^Étape 2 sur \d+$/);
  await expect(step2).toBeVisible();
  await expect(page).toHaveURL(/[?&]s=3(&|$)/);
  await expectAccessible(page);

  // A reload comes back to step 2 (rendered on the server from `?s=3`); ← and Space move again.
  await page.reload();
  await expect(step2).toBeVisible();
  await goToSlide(page, 2, /^Étape 2 sur \d+$/);
  await page.keyboard.press('ArrowLeft');
  await expect(slideHeading(page, /^Étape 1 sur \d+$/)).toBeVisible();
  await page.keyboard.press(' ');
  await expect(step2).toBeVisible();

  // The teacher's note never reaches the projector (a phrase found only in the note: its start,
  // « Conçue pour une personne suppléante », is also the label of a resource form checkbox).
  expect(await payloads(page)).not.toContain('deux miroirs suivent la même personne guide');

  // A visual timer, no sound: 30 s, then stopped.
  await page.getByRole('button', { name: 'Minuterie de 30 s' }).click();
  await expect(page.getByRole('timer', { name: 'Temps restant' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Arrêter la minuterie' }).click();
  await expect(page.getByRole('timer')).toHaveCount(0);

  // « Quitter la présentation »: back to the resource, on the same version.
  await page.getByRole('link', { name: 'Quitter la présentation' }).click();
  await page.waitForURL(new RegExp(`/library/items/${MIRROR}\\?v=`));
});

test('an experiment opens on safety for students, never the teacher’s safety notes', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);

  await page.goto(presenter(experimentId, '?s=2'));
  await expect(slideHeading(page, 'Sécurité')).toBeVisible();
  await expect(
    page.getByText('Écoute les consignes de sécurité de ton enseignant·e.'),
  ).toBeVisible();
  const html = await payloads(page);
  expect(html).not.toContain(SAFETY_SENTINEL);
  expect(html).not.toContain(TEACHER_SENTINEL);
  expect(html).not.toContain(KEY_SENTINEL);
  await expectAccessible(page);
  await page.goto(presenter(experimentId, '?s=3'));
  await expect(slideHeading(page, 'Matériel')).toBeVisible();
  await expect(page.getByText('Crayons et feuilles')).toBeVisible();

  // The demo experiment: title, « Sécurité », then « Matériel ». Its safety notes stay off.
  const [demo] = await query<{ hazards: string[] }>(
    `select array(select jsonb_array_elements_text(safety_notes->'hazards')) as hazards
     from public.library_items where id = $1`,
    [SPONGES],
  );
  await page.goto(presenter(SPONGES));
  await expect(slideHeading(page, /^Éponges et élastiques/)).toBeVisible();
  await goToSlide(page, 1, 'Sécurité');
  await page.keyboard.press('ArrowRight');
  await expect(slideHeading(page, 'Matériel')).toBeVisible();
  const demoHtml = await payloads(page);
  expect(demo?.hazards.length).toBeGreaterThan(0);
  for (const hazard of demo?.hazards ?? []) expect(demoHtml).not.toContain(hazard);
});

test('a quiz shows one answer when asked, and never ships the key or a level name', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${quizId}`);
  // The version is chosen on the item page: « Débutant » (version 2).
  const debutant = page.getByRole('button', { name: 'Débutant', exact: true });
  await expect(async () => {
    await debutant.click();
    await expect(debutant).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass();
  await page.getByRole('link', { name: 'Présenter à la classe' }).click();
  await page.waitForURL(new RegExp(`/projector/items/${quizId}\\?v=`));
  await expect(slideHeading(page, `${QUIZ} — version 2`)).toBeVisible();
  // From here on, every response the projector receives (the item page before it carries the
  // teacher's « Guide et corrigé », which is not a class view).
  const bodies = recordBodies(page);

  // Nothing of the key is on the page before « Afficher la réponse », and no level name.
  const before = await payloads(page);
  expect(before).not.toContain(KEY_SENTINEL);
  expect(before).not.toContain(EXPLANATION);
  expect(before).not.toContain(TEACHER_SENTINEL);
  expect(before).not.toContain('Débutant');

  await goToSlide(page, 1, 'Question 1 sur 5');
  await expect(page.getByText(FIRST_QUESTION)).toBeVisible();
  await expect(page.getByText('Bonne réponse', { exact: true })).toHaveCount(0);
  await expectAccessible(page);

  const show = page.getByRole('button', { name: 'Afficher la réponse' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await show.click();
  const hide = page.getByRole('button', { name: 'Masquer la réponse' });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  // The right choice is marked in place, with the explanation below.
  await expect(page.getByRole('listitem').filter({ hasText: '893' })).toContainText(
    'Bonne réponse',
  );
  await expect(page.getByRole('listitem').filter({ hasText: '389' })).not.toContainText(
    'Bonne réponse',
  );
  await expect(page.getByText(EXPLANATION)).toBeVisible();
  await expectAccessible(page);

  await hide.click();
  await expect(page.getByText(EXPLANATION)).toHaveCount(0);
  // The next question starts hidden.
  await page.keyboard.press('ArrowRight');
  await expect(slideHeading(page, 'Question 2 sur 5')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Afficher la réponse' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  // Over the whole visit, only the asked answer left the server: no other answer, no solution,
  // no teacher note, in any response.
  const all = bodies.join('\n');
  expect(all).not.toContain(KEY_SENTINEL);
  expect(all).not.toContain(TEACHER_SENTINEL);
});

test('the player needs a landscape screen at least 768 px wide', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(presenter(quizId));
  await expect(slideHeading(page, QUIZ)).toBeVisible();
  await expect(async () => {
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Suivante' }).click();
    await expect(slideHeading(page, 'Question 1 sur 5')).toBeVisible({ timeout: 1000 });
  }).toPass();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await expect(page.getByText(NARROW)).toBeHidden();
  await expectAccessible(page);

  // Narrower, or a tablet held upright: the message instead of the slides.
  for (const size of [
    { width: 700, height: 500 },
    { width: 800, height: 1100 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.getByText(NARROW)).toBeVisible();
    await expect(slideHeading(page, 'Question 1 sur 5')).toBeHidden();
    await expectAccessible(page);
  }
});

test('only resources a teacher can use in class are presented, to library users', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  // No player and not projectable: no button, and the address is not found.
  await page.goto(`/library/items/${worksheetId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Présenter à la classe' })).toHaveCount(0);
  await page.goto(presenter(worksheetId));
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  // A colleague's private draft.
  await page.goto(presenter(draftId));
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  // Not an id.
  await page.goto('/projector/items/pas-un-id');
  await expect(page.getByText(NOT_FOUND)).toBeVisible();

  // Office staff have no library, so no projector either.
  await resetLanguage(DEMO.office);
  await page.context().clearCookies();
  await login(page, DEMO.office);
  await page.goto(presenter(quizId));
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
});
