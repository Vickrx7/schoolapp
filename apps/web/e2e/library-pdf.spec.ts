import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { closeDb, deleteLibraryItems, insertReadyItem, resetLanguage } from './db';
import { DEMO, e2ePrefix, login } from './helpers';

/**
 * « Télécharger le PDF » of a library resource (Phase 4, DECISIONS D-075, D-053, D-062; plan
 * H4 library.spec scenario 6): the student sheet and « Guide et corrigé » come back as PDFs that
 * are never cached, from the item page and the print page. A colleague's private draft, a
 * document that does not exist and office staff get a bare 404. The items are written here
 * (`insertReadyItem`), not taken from the demo pack.
 */

const PREFIX = e2ePrefix();
const QUIZ = `${PREFIX} Quiz PDF`;
/** `pdfFileSlug(QUIZ)`: the title as a file name. */
const QUIZ_FILE = QUIZ.toLowerCase().replace(/[^a-z0-9]+/g, '-');

let quizId = '';
let draftId = '';

test.beforeAll(async () => {
  quizId = await insertReadyItem({
    author: null,
    type: 'quiz',
    title: QUIZ,
    status: 'board_approved',
    levels: true,
  });
  draftId = await insertReadyItem({
    author: DEMO.teacher5,
    type: 'worksheet',
    title: `${PREFIX} Brouillon de Marc`,
  });
});

test.afterAll(async () => {
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await resetLanguage(DEMO.office);
  await closeDb();
});

/** Fetched with the page's session, as the link would be. */
async function expectPdf(page: Page, href: string): Promise<APIResponse> {
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const body = await response.body();
  expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  return response;
}

const pageCount = async (response: APIResponse) =>
  (await response.body()).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;

test('the student sheet and the guide download as PDFs', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${quizId}`);

  // The version on screen (the base version, number 1), saved rather than opened.
  const student = page.getByTestId('library-pdf-student');
  await expect(student).toHaveText('PDF de la feuille de l’élève');
  const studentHref = await student.getAttribute('href');
  expect(studentHref).toMatch(
    new RegExp(`^/library/items/${quizId}/pdf\\?doc=student&v=[0-9a-f-]{36}&download=1$`),
  );
  const sheet = await expectPdf(page, studentHref!);
  expect(sheet.headers()['content-disposition']).toBe(
    `attachment; filename="${QUIZ_FILE}-eleves-v1.pdf"`,
  );

  const teacher = page.getByTestId('library-pdf-teacher');
  await expect(teacher).toHaveText('PDF du guide et du corrigé');
  const guide = await expectPdf(page, (await teacher.getAttribute('href'))!);
  expect(guide.headers()['content-disposition']).toBe(
    `attachment; filename="${QUIZ_FILE}-guide-corrige-v1.pdf"`,
  );

  // Every version: one sheet each (at least a page each), opened in the browser.
  const all = await expectPdf(page, `/library/items/${quizId}/pdf?doc=student`);
  expect(all.headers()['content-disposition']).toBe(`inline; filename="${QUIZ_FILE}-eleves.pdf"`);
  expect(await pageCount(all)).toBeGreaterThanOrEqual(5);
  // The guide once, then « Corrigé — version n » for each of the five versions.
  const keys = await expectPdf(page, `/library/items/${quizId}/pdf?doc=teacher`);
  expect(await pageCount(keys)).toBeGreaterThanOrEqual(6);

  // The print page offers the same PDFs for the versions chosen there.
  await page.goto(`/library/items/${quizId}/print?doc=student`);
  await expect(page.getByTestId('library-pdf-student')).toHaveAttribute(
    'href',
    new RegExp(`/pdf\\?doc=student&v=(?:[0-9a-f-]{36},){4}[0-9a-f-]{36}&download=1$`),
  );
  await expect(page.getByTestId('library-pdf-teacher')).toBeVisible();
});

test('a PDF is found only by who may open the resource', async ({ page }) => {
  await login(page, DEMO.teacher3);
  // A colleague's private draft, and a document that does not exist.
  expect((await page.request.get(`/library/items/${draftId}/pdf`)).status()).toBe(404);
  expect((await page.request.get(`/library/items/${quizId}/pdf?doc=answers`)).status()).toBe(404);
  expect((await page.request.get('/library/items/not-an-id/pdf')).status()).toBe(404);

  // Office staff have no library screens, even for an approved resource (D-078).
  await resetLanguage(DEMO.office);
  await page.context().clearCookies();
  await login(page, DEMO.office);
  const office = await page.request.get(`/library/items/${quizId}/pdf?doc=teacher`);
  expect(office.status()).toBe(404);
  expect(office.headers()['cache-control']).toBe('private, no-store');
});
