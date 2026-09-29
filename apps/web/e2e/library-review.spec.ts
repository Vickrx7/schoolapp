import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems, insertReadyItem, query } from './db';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * Approving library resources for the board (Phase 4, DECISIONS D-063, D-064, D-079): a teacher
 * proposes a resource with faith content, the board's reviewer finds it in « Approbation des
 * ressources », reviews the faith content before approving it, and colleagues then see it as
 * approved; a resource sent back for rework shows the reviewer's note in « Mes ressources ».
 * Every resource made here is titled « E2E-… » and deleted afterwards.
 */

const PREFIX = e2ePrefix();

let designatedHere = false;

test.beforeAll(async () => {
  // The demo board's reviewer (supabase/seed.sql designates her; kept if already there).
  const inserted = await query(
    `insert into public.library_reviewers (board_id, user_id, approves_content, reviews_faith)
     select $1, id, true, true from public.users where email = $2
     on conflict do nothing returning user_id`,
    [SEED.board, DEMO.boardAdmin],
  );
  designatedHere = inserted.length > 0;
});

test.afterAll(async () => {
  await deleteLibraryItems({ titlePrefix: PREFIX });
  if (designatedHere) {
    await query(
      `delete from public.library_reviewers r using public.users u
       where r.user_id = u.id and u.email = $1 and r.board_id = $2`,
      [DEMO.boardAdmin, SEED.board],
    );
  }
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

async function statusOf(itemId: string) {
  const [row] = await query<{ status: string; share_scope: string; review_note: string | null }>(
    `select status::text, share_scope::text, review_note from public.library_items where id = $1`,
    [itemId],
  );
  return row;
}

test('a faith resource is proposed, faith-reviewed, then approved for the board', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const title = `${PREFIX} Jeu des nombres et de la création`;
  const itemId = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'game',
    title,
    status: 'teacher_reviewed',
    faith: true,
  });

  // Isabelle proposes it to the board.
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${itemId}`);
  const workflow = page.getByRole('region', { name: 'Révision et partage' });
  // Faith content goes to the whole board only through the faith review.
  await expect(
    workflow.getByText(/^Le contenu de foi doit être révisé par la personne désignée/),
  ).toBeVisible();
  // Wait until the page is interactive: a click before that is lost.
  await page.waitForLoadState('networkidle');
  await workflow.getByRole('button', { name: 'Proposer au conseil' }).click();
  await expect(page.getByText('Ressource proposée au conseil.')).toBeVisible();
  await expect(workflow.getByRole('button', { name: 'Retirer la demande' })).toBeVisible();

  // Nathalie, the board's reviewer, finds it in « À approuver » (and « Contenu de foi »).
  await page.context().clearCookies();
  await login(page, DEMO.boardAdmin);
  await page.goto('/library');
  await page.getByRole('link', { name: /^Approbation des ressources/ }).click();
  await page.waitForURL(/\/library\/review$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Approbation des ressources' }),
  ).toBeVisible();
  const queues = page.getByRole('navigation', { name: 'Files d’approbation' });
  await expect(queues.getByRole('link', { name: /^À approuver \(\d+\)$/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await expectAccessible(page);
  await queues.getByRole('link', { name: /^Contenu de foi \(\d+\)$/ }).click();
  await page.waitForURL(/queue=faith/);
  await page.getByRole('link', { name: title }).click();
  await page.waitForURL(new RegExp(`/library/items/${itemId}$`));

  // « Approuver pour le conseil » waits for the faith review.
  const decision = page.getByRole('region', { name: 'Décision' });
  const approve = decision.getByRole('button', { name: 'Approuver pour le conseil' });
  await expect(approve).toBeDisabled();
  await expect(decision.getByText('En attente de la révision du contenu de foi')).toBeVisible();
  await expectAccessible(page);
  await decision.getByRole('button', { name: 'Contenu de foi conforme' }).click();
  await expect(page.getByText('Contenu de foi révisé.')).toBeVisible();
  await expect(decision.getByText('Le contenu de foi a été révisé.')).toBeVisible();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText('Ressource approuvée pour le conseil.')).toBeVisible();
  expect(await statusOf(itemId)).toMatchObject({
    status: 'board_approved',
    share_scope: 'board',
  });

  // Marc, in another class, now finds it approved.
  await page.context().clearCookies();
  await login(page, DEMO.teacher5);
  await page.goto(`/library/items/${itemId}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const badges = page.getByRole('list', { name: 'Caractéristiques de la ressource' });
  await expect(badges).toContainText('Approuvée par le conseil');
  await expect(badges).toContainText('Foi');
});

test('a resource sent back for rework shows the reviewer’s note to its author', async ({
  page,
}) => {
  const title = `${PREFIX} Fiche à retravailler`;
  const note = 'Ajoutez un exemple avec des centaines avant la première question.';
  const itemId = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'worksheet',
    title,
    status: 'teacher_reviewed',
  });
  // Proposed to the board (as « Proposer au conseil » does).
  await query(
    `update public.library_items set review_requested_at = now(), review_requested_by = author_id
     where id = $1`,
    [itemId],
  );

  await login(page, DEMO.boardAdmin);
  await page.goto(`/library/items/${itemId}`);
  const decision = page.getByRole('region', { name: 'Décision' });
  const dialog = await openDialog(
    page,
    decision.getByRole('button', { name: 'Renvoyer pour révision' }),
  );
  await expect(dialog).toContainText('La ressource redevient privée et « À retravailler »');
  // A note is required.
  await dialog.getByRole('button', { name: 'Renvoyer pour révision' }).click();
  await expect(dialog.getByText('Ce champ est obligatoire.')).toBeVisible();
  await dialog.getByLabel('Note pour la personne qui a créé la ressource').fill(note);
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Renvoyer pour révision' }).click();
  await expect(page.getByText('Ressource renvoyée pour révision.')).toBeVisible();
  expect(await statusOf(itemId)).toMatchObject({
    status: 'rejected',
    share_scope: 'private',
    review_note: note,
  });

  // Isabelle's « À retravailler » tab shows it with the note.
  await page.context().clearCookies();
  await login(page, DEMO.teacher3);
  await page.goto('/library/mine?tab=rework');
  await expect(page.getByRole('link', { name: /^À retravailler \(\d+\)$/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title }) });
  await expect(row).toContainText(`Note de la personne responsable de la révision : ${note}`);
  await expectAccessible(page);
});
