import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDb, deleteLibraryItems, insertReadyItem } from './db';
import {
  bulkDrafts,
  clearActiveBulkRuns,
  deleteBulkRun,
  markFromDemoPack,
  renameDraft,
  startBulkRun,
  waitForBulkRun,
} from './db-bulk';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * Bulk generation (Phase 5, DECISIONS D-095 to D-098): a run planned and started for the demo
 * board as the operator's CLI does (3e année Mathématiques, quizzes with every board level, a $5
 * cap), ended by the worker with the fake provider in one step. The board's content reviewer finds
 * its drafts in « Brouillons du conseil » with the run's summary line, approves one for the board
 * in one step, and a teacher then finds it approved. A board draft that came from no run (a
 * content pack's resource that was not ready when imported, D-100) is listed under « Autres
 * brouillons du conseil ». The run and the drafts are deleted afterwards. Needs the worker running
 * with AI_PROVIDER=fake.
 */

const PREFIX = e2ePrefix('bulk');
let runId = '';

// The second test deletes a draft the first one left as a draft.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await clearActiveBulkRuns();
  ({ runId } = await startBulkRun({ types: ['quiz'], maxCostUsd: 5 }));
  expect(await waitForBulkRun(runId)).toBe('completed');
});

test.afterAll(async () => {
  if (runId) await deleteBulkRun(runId);
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await closeDb();
});

/** A click before the page is interactive is lost: retry until the dialog opens. */
async function openDialog(page: Page, trigger: Locator) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test('the reviewer approves a board draft in one step, and teachers find it approved', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const [draft] = await bulkDrafts(runId);
  expect(draft).toBeDefined();
  const title = `${PREFIX} Quiz des castors`;
  await renameDraft(draft!.id, title);

  // Nathalie, the board's content reviewer: « Approbation des ressources », then the drafts tab.
  await login(page, DEMO.boardAdmin);
  await page.goto('/library/review');
  await page.getByRole('link', { name: /^Brouillons du conseil \(\d+\)$/ }).click();
  await page.waitForURL(/\/library\/review\?queue=drafts$/);
  const run = page
    .getByTestId('board-draft-run')
    .filter({ has: page.getByRole('link', { name: title }) });
  // The run's summary line: created, similar titles, failures, spent of the cap.
  await expect(
    run.getByRole('heading', {
      level: 3,
      name: /^Lot du .+\s: \d+ créées? · \d+ titres? semblables? · \d+ échecs? · [\d,]+ \$ US sur 5,00 \$ US$/,
    }),
  ).toBeVisible();
  await expect(run.getByText(/^\d+ brouillons? à réviser$/)).toBeVisible();
  await expectAccessible(page);

  // Her draft: « Approuver pour le conseil », with the originality box.
  await run.getByRole('link', { name: title }).click();
  await page.waitForURL(`**/library/items/${draft!.id}`);
  await page.waitForLoadState('networkidle');
  const panel = page.getByRole('region', { name: 'Décision' });
  await expect(
    panel.getByRole('heading', { name: 'Brouillon du conseil', exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  const dialog = await openDialog(
    page,
    panel.getByRole('button', { name: 'Approuver pour le conseil' }),
  );
  const submit = dialog.getByRole('button', { name: 'Approuver pour le conseil' });
  await expect(submit).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /^Je confirme que ce contenu est original/ }).check();
  await submit.click();
  await expect(page.getByText('Ressource approuvée pour le conseil.')).toBeVisible();
  await expect(page.getByText('Approuvée par le conseil').first()).toBeVisible();

  // Isabelle finds it approved in her search.
  await page.context().clearCookies();
  await login(page, DEMO.teacher3);
  await page.goto(`/library?q=${encodeURIComponent(title)}`);
  const card = page.getByRole('article').filter({ has: page.getByRole('link', { name: title }) });
  await expect(card).toBeVisible();
  await expect(card.getByText('Approuvée par le conseil')).toBeVisible();
});

test('a board draft can be deleted by the reviewer', async ({ page }) => {
  test.setTimeout(90_000);
  const drafts = (await bulkDrafts(runId)).filter((d) => d.status === 'draft');
  const draft = drafts.at(-1);
  expect(draft).toBeDefined();
  await login(page, DEMO.boardAdmin);
  await page.goto(`/library/items/${draft!.id}`);
  await page.waitForLoadState('networkidle');
  const panel = page.getByRole('region', { name: 'Décision' });
  const dialog = await openDialog(
    page,
    panel.getByRole('button', { name: 'Supprimer le brouillon' }),
  );
  await dialog.getByRole('button', { name: 'Supprimer le brouillon' }).click();
  await page.waitForURL(/\/library\/review\?queue=drafts$/);
  await expect(page.getByText('Brouillon supprimé.')).toBeVisible();
  expect((await bulkDrafts(runId)).some((d) => d.id === draft!.id)).toBe(false);
});

test('a board draft from a content pack waits under « Autres brouillons du conseil »', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const title = `${PREFIX} Fiche importée d’un ensemble`;
  const itemId = await insertReadyItem({ author: null, type: 'worksheet', title, levels: true });
  await markFromDemoPack(itemId);

  await login(page, DEMO.boardAdmin);
  await page.goto('/library/review?queue=drafts');
  const others = page.getByRole('region', { name: 'Autres brouillons du conseil' });
  const card = others.getByRole('article').filter({ has: page.getByRole('link', { name: title }) });
  await expect(card.getByText(/^Ensemble\s: .+ 2026\.1$/)).toBeVisible();
  await expect(card.getByText('Brouillon', { exact: true })).toBeVisible();
  await expectAccessible(page);

  await card.getByRole('link', { name: title }).click();
  await page.waitForURL(`**/library/items/${itemId}`);
  await page.waitForLoadState('networkidle');
  const panel = page.getByRole('region', { name: 'Décision' });
  await expect(
    panel.getByRole('heading', { name: 'Brouillon du conseil', exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approuver pour le conseil' })).toBeEnabled();
});
