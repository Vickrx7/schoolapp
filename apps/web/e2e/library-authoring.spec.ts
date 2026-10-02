import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems, insertReadyItem, query } from './db';
import { DEMO, chip, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * Writing library resources (Phase 4, DECISIONS D-061 to D-067, D-076): the editor with every
 * question kind and its answers inline, the readiness checklist before « J’ai révisé cette
 * ressource », sharing with the first-name guard, safety notes, adding a resource to a lesson,
 * and the device draft. Every resource made here is titled « E2E-… » and deleted afterwards; the
 * lesson link is removed.
 */

const PREFIX = e2ePrefix();
const HUARD = 'Le huard, oiseau des lacs';
const UNIT_FRA_3 = '30000000-0000-4000-8000-000000000301';

test.afterAll(async () => {
  await query(
    `update public.unit_lessons set library_item_id = null
     where unit_id = $1 and library_item_id = (select id from public.library_items where title = $2)`,
    [UNIT_FRA_3, HUARD],
  );
  await deleteLibraryItems({ titlePrefix: PREFIX });
  await closeDb();
});

/** One question of the editor, by its number and kind (« Question 2 · Vrai ou faux »). */
const question = (page: Page, n: number, kind: string) =>
  page.getByRole('group', { name: `Question ${n} · ${kind}` });

/** Adds a question of a kind at the end of the list. */
async function addQuestion(page: Page, kind: string) {
  await page.getByLabel('Type de la prochaine question').selectOption({ label: kind });
  await page.getByRole('button', { name: 'Ajouter une question' }).click();
}

const saveBar = (page: Page) => page.getByTestId('library-save-bar');

async function save(page: Page) {
  await saveBar(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
}

/** The readiness line of a requirement (`data-readiness`), with whether it is met. */
const readiness = (page: Page, code: string) => page.locator(`li[data-readiness="${code}"]`);

/** A click before the page is interactive is lost: retry until the dialog opens. */
async function openDialog(page: Page, trigger: Locator) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test('a teacher writes a quiz with every question kind, marks it reviewed and shares it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const title = `${PREFIX} Quiz de lecture`;
  await login(page, DEMO.teacher3);
  await page.goto('/library/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvelle ressource' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: /^Quiz/ }).click();
  await page.waitForURL(/\/library\/new\?type=quiz/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Nouvelle ressource : Quiz' }),
  ).toBeVisible();

  await page.getByLabel('Titre', { exact: true }).fill(title);
  // Isabelle teaches 3e année only: it is chosen already.
  await expect(page.getByRole('checkbox', { name: '3e année' })).toBeChecked();
  await page.getByLabel('Matière', { exact: true }).selectOption({ label: 'Français' });

  // One question of each kind, with its answer written next to it.
  await addQuestion(page, 'Choix multiple');
  const mc = question(page, 1, 'Choix multiple');
  await mc.getByLabel('Énoncé').fill('Quel oiseau a un cri qui ressemble à un rire?');
  await mc.getByLabel('Choix A', { exact: true }).fill('Le geai bleu');
  await mc.getByLabel('Choix B', { exact: true }).fill('Le huard');
  await mc.getByLabel('Choix B : bonne réponse').check();

  await addQuestion(page, 'Vrai ou faux');
  const tf = question(page, 2, 'Vrai ou faux');
  await tf.getByLabel('Énoncé').fill('Le huard vit dans le désert.');
  await tf.getByRole('radio', { name: 'Faux' }).check();

  await addQuestion(page, 'Associations');
  const matching = question(page, 3, 'Associations');
  await matching.getByLabel('Énoncé').fill('Associe chaque animal à son milieu.');
  await matching.getByLabel('Élément 1', { exact: true }).fill('Le huard');
  await matching.getByLabel('Correspondance de l’élément 1').fill('Le lac');
  await matching.getByLabel('Élément 2', { exact: true }).fill('Le castor');
  await matching.getByLabel('Correspondance de l’élément 2').fill('La rivière');

  await addQuestion(page, 'Mise en ordre');
  const ordering = question(page, 4, 'Mise en ordre');
  await ordering.getByLabel('Énoncé').fill('Place les étapes dans l’ordre.');
  await ordering.getByLabel('Élément 1', { exact: true }).fill('Le huard pond ses œufs.');
  await ordering.getByLabel('Élément 2', { exact: true }).fill('Les poussins éclosent.');

  await addQuestion(page, 'Réponse courte');
  const short = question(page, 5, 'Réponse courte');
  await short.getByLabel('Énoncé').fill('Où le huard fait-il son nid?');
  await short.getByLabel('Réponse attendue (corrigé)').fill('Au bord de l’eau.');
  await short.getByRole('button', { name: 'Ajouter une réponse acceptée' }).click();
  await short.getByLabel('Réponse acceptée 1', { exact: true }).fill('au bord du lac');
  await expectAccessible(page);

  await save(page);
  await page.waitForURL(/\/library\/items\/[0-9a-f-]{36}\/edit$/);
  const itemId = /items\/([0-9a-f-]{36})/.exec(page.url())![1]!;

  // The answers come back from the database, next to their questions.
  await page.reload();
  await expect(page.getByLabel('Titre', { exact: true })).toHaveValue(title);
  await expect(
    question(page, 1, 'Choix multiple').getByLabel('Choix B', { exact: true }),
  ).toHaveValue('Le huard');
  await expect(
    question(page, 1, 'Choix multiple').getByLabel('Choix B : bonne réponse'),
  ).toBeChecked();
  await expect(
    question(page, 2, 'Vrai ou faux').getByRole('radio', { name: 'Faux' }),
  ).toBeChecked();
  await expect(
    question(page, 3, 'Associations').getByLabel('Correspondance de l’élément 2'),
  ).toHaveValue('La rivière');
  await expect(
    question(page, 4, 'Mise en ordre').getByLabel('Élément 1', { exact: true }),
  ).toHaveValue('Le huard pond ses œufs.');
  await expect(
    question(page, 5, 'Réponse courte').getByLabel('Réponse acceptée 1', { exact: true }),
  ).toHaveValue('au bord du lac');
  await expect(page.getByText('Brouillon non enregistré récupéré.')).toHaveCount(0);

  // « J’ai révisé… » is refused while the checklist is incomplete: no attente, no materials.
  await page.goto(`/library/items/${itemId}`);
  await expect(readiness(page, 'expectations')).toHaveAttribute('data-ready', 'false');
  await expect(readiness(page, 'materials')).toHaveAttribute('data-ready', 'false');
  let dialog = await openDialog(
    page,
    page.getByRole('button', { name: 'J’ai révisé cette ressource' }),
  );
  await dialog.getByRole('checkbox', { name: /^Je confirme que ce contenu est original/ }).check();
  await dialog.getByRole('button', { name: 'Marquer comme révisée' }).click();
  await expect(dialog.getByText(/^Cette ressource n’est pas complète\./)).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  // She adds C1.2, the materials and a tag.
  await page.getByRole('link', { name: 'Modifier' }).click();
  await page.waitForURL(/\/edit$/);
  await page.getByRole('checkbox', { name: /^C1\.2 / }).check();
  await page.getByRole('button', { name: 'Aucun matériel particulier' }).click();
  // The tag is a chip: its checkbox is visually hidden, so the label is what gets tapped.
  await chip(page, 'Lecture').click();
  await expect(page.getByRole('checkbox', { name: 'Lecture', exact: true })).toBeChecked();
  await save(page);
  await expect(saveBar(page).getByText(/^Enregistré à /)).toBeVisible();

  await page.goto(`/library/items/${itemId}`);
  await expect(readiness(page, 'expectations')).toHaveAttribute('data-ready', 'true');
  dialog = await openDialog(
    page,
    page.getByRole('button', { name: 'J’ai révisé cette ressource' }),
  );
  await dialog.getByRole('checkbox', { name: /^Je confirme que ce contenu est original/ }).check();
  await dialog.getByRole('button', { name: 'Marquer comme révisée' }).click();
  await expect(page.getByText('Ressource marquée comme révisée.')).toBeVisible();
  await expect(page.getByText('Révisée', { exact: true }).first()).toBeVisible();

  // « Partager » → « Avec mon école ».
  dialog = await openDialog(page, page.getByRole('button', { name: 'Partager', exact: true }));
  await dialog.getByRole('radio', { name: 'Avec mon école' }).check();
  await dialog.getByRole('button', { name: 'Partager', exact: true }).click();
  await expect(page.getByText('Ressource partagée avec votre école.')).toBeVisible();
  // The page refreshes after the message: « Détails » then says « Partagée avec l’école », and axe
  // checks the refreshed page, not one whose head is being replaced.
  await page.getByRole('tab', { name: 'Détails' }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Détails' })
      .getByText('Partagée avec l’école', { exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('a student’s first name is confirmed before sharing', async ({ page }) => {
  const title = `${PREFIX} Fiche sur Samuel de Champlain`;
  const itemId = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'worksheet',
    title,
    status: 'teacher_reviewed',
  });
  await query(`update public.library_items set summary = $2 where id = $1`, [
    itemId,
    'Une fiche sur le voyage de Samuel de Champlain.',
  ]);
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${itemId}`);
  let dialog = await openDialog(page, page.getByRole('button', { name: 'Partager', exact: true }));
  await dialog.getByRole('radio', { name: 'Avec mon école' }).check();
  await dialog.getByRole('button', { name: 'Partager', exact: true }).click();

  // Samuel is a student of Isabelle's class: the name is listed, and sharing waits for her.
  dialog = page.getByRole('dialog', { name: 'Prénoms d’élèves à vérifier' });
  await expect(dialog.getByText(/Samuel/).first()).toBeVisible();
  const share = dialog.getByRole('button', { name: 'Partager', exact: true });
  await expect(share).toBeDisabled();
  await expectAccessible(page);
  await dialog.getByRole('checkbox', { name: 'Samuel : ce n’est pas un nom d’élève' }).check();
  await share.click();
  await expect(page.getByText('Ressource partagée avec votre école.')).toBeVisible();
  const [row] = await query<{ share_scope: string }>(
    `select share_scope from public.library_items where id = $1`,
    [itemId],
  );
  expect(row?.share_scope).toBe('school');
});

test('an experiment without safety notes cannot be marked reviewed', async ({ page }) => {
  const itemId = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'experiment',
    title: `${PREFIX} Expérience sans notes`,
  });
  await query(`update public.library_items set safety_notes = null where id = $1`, [itemId]);
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${itemId}`);
  await expect(readiness(page, 'safety')).toHaveAttribute('data-ready', 'false');
  const dialog = await openDialog(
    page,
    page.getByRole('button', { name: 'J’ai révisé cette ressource' }),
  );
  await dialog.getByRole('checkbox', { name: /^Je confirme que ce contenu est original/ }).check();
  await dialog.getByRole('button', { name: 'Marquer comme révisée' }).click();
  await expect(
    dialog.getByText(
      'Les notes de sécurité sont obligatoires pour une expérience ou un défi STIM.',
    ),
  ).toBeVisible();
  const [row] = await query<{ status: string }>(
    `select status from public.library_items where id = $1`,
    [itemId],
  );
  expect(row?.status).toBe('draft');
});

test('a resource is attached to the next lesson that shares its attente', async ({ page }) => {
  await login(page, DEMO.teacher3);
  const [huard] = await query<{ id: string }>(
    `select id from public.library_items where title = $1`,
    [HUARD],
  );
  await page.goto(`/library/items/${huard!.id}`);
  const dialog = await openDialog(
    page,
    page.getByRole('button', { name: 'Ajouter à ma planification' }),
  );
  // 3e année, Français, and lesson 4 « Trouver l'idée principale » (C1.2), the next one.
  await expect(dialog.getByLabel('Unité')).toContainText('Français');
  await expect(dialog.getByLabel('Leçon', { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(dialog.getByLabel('Leçon', { exact: true }).locator('option:checked')).toHaveText(
    /^Leçon 4\s: .*\(prochaine leçon\)$/,
  );
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Joindre à la leçon 4' }).click();
  await expect(page.getByText('Jointe à la leçon 4.')).toBeVisible();

  // Planification: lesson 4 has the resource, and the unit still has 8 lessons.
  await page.goto(`/classes/${SEED.class3}/planning/${UNIT_FRA_3}`);
  const lessons = page.getByRole('main').locator('ol > li');
  await expect(lessons).toHaveCount(8);
  const lesson4 = lessons.nth(3);
  await expect(lesson4.getByTestId('lesson-resource-chip')).toContainText(HUARD);
  await expectAccessible(page);

  // « Retirer la ressource ».
  await lesson4.getByRole('button', { name: 'Retirer la ressource de la leçon 4' }).click();
  await expect(page.getByText('Ressource retirée de la leçon.')).toBeVisible();
  await expect(lesson4.getByTestId('lesson-resource-chip')).toHaveCount(0);
});

test('the editor’s device draft survives a reload before saving', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/library/new?type=exit_ticket');
  const title = page.getByLabel('Titre', { exact: true });
  await expect(title).toBeVisible();
  await page.waitForLoadState('networkidle');
  await title.fill(`${PREFIX} Billet non enregistré`);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) => k.startsWith('lynx-draft:library-item:')).length,
      ),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText('Brouillon non enregistré récupéré.')).toBeVisible();
  await expect(title).toHaveValue(`${PREFIX} Billet non enregistré`);
  await page.getByRole('button', { name: 'Effacer le brouillon' }).click();
  await expect(title).toHaveValue('');
});

test('saving a resource that waits for approval says what it withdraws, and asks first', async ({
  page,
}) => {
  const itemId = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'worksheet',
    title: `${PREFIX} Fiche proposée`,
    status: 'teacher_reviewed',
  });
  await query(
    `update public.library_items set review_requested_at = now(), review_requested_by = author_id
     where id = $1`,
    [itemId],
  );
  const requested = async () =>
    (
      await query<{ requested: boolean }>(
        `select review_requested_at is not null as requested from public.library_items where id = $1`,
        [itemId],
      )
    )[0]?.requested;

  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${itemId}/edit`);
  await expect(
    page.getByText(
      'Cette ressource est en attente d’approbation : l’enregistrer retire la demande.',
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  // Nothing changed: nothing to send, so the request cannot be withdrawn by accident.
  const saveButton = saveBar(page).getByRole('button', { name: 'Enregistrer', exact: true });
  await expect(saveButton).toBeDisabled();

  await page.getByLabel('Titre', { exact: true }).fill(`${PREFIX} Fiche proposée (modifiée)`);
  await save(page);
  const dialog = page.getByRole('dialog', { name: 'Enregistrer les modifications?' });
  await expect(dialog).toContainText('l’enregistrer retire la demande');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  expect(await requested()).toBe(true);

  await save(page);
  await dialog.getByRole('button', { name: 'Enregistrer quand même' }).click();
  await expect(saveBar(page)).toContainText('Enregistré à');
  expect(await requested()).toBe(false);
});

test('closer supervision unticks « Conçue pour une personne suppléante » and the save goes through', async ({
  page,
}) => {
  const itemId = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'experiment',
    title: `${PREFIX} Expérience pour la suppléance`,
    subFriendly: true,
  });
  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${itemId}/edit`);
  const forSubs = page.getByRole('checkbox', { name: 'Conçue pour une personne suppléante' });
  await expect(forSubs).toBeChecked();
  await page.getByRole('radio', { name: 'Supervision étroite' }).check();
  await expect(forSubs).not.toBeChecked();
  await expect(forSubs).toBeDisabled();
  await save(page);
  await expect(saveBar(page)).toContainText('Enregistré à');
  const [row] = await query<{ sub_friendly: boolean; supervision: string }>(
    `select sub_friendly, safety_notes ->> 'supervision' as supervision
     from public.library_items where id = $1`,
    [itemId],
  );
  expect(row).toEqual({ sub_friendly: false, supervision: 'close' });
});

test('a result opened while choosing for a lesson keeps the lesson and the search', async ({
  page,
}) => {
  const [lesson] = await query<{ id: string }>(
    `select id from public.unit_lessons where unit_id = $1 and sequence_number = 4`,
    [UNIT_FRA_3],
  );
  await login(page, DEMO.teacher3);
  await page.goto(`/library?q=huard&attachTo=${lesson!.id}`);
  await page
    .getByRole('region', { name: 'Résultats' })
    .getByRole('link', { name: HUARD, exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/library/items/[0-9a-f-]{36}\\?q=huard&attachTo=${lesson!.id}$`),
  );
  await expect(page.getByTestId('attach-banner')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Retour aux résultats' })).toHaveAttribute(
    'href',
    `/library?q=huard&attachTo=${lesson!.id}`,
  );
  await expectAccessible(page);
  await page.getByRole('button', { name: `Joindre « ${HUARD} » à cette leçon` }).click();
  await expect(page.getByText('Jointe à la leçon 4.')).toBeVisible();
  await page.waitForURL(new RegExp(`/classes/${SEED.class3}/planning/${UNIT_FRA_3}`));
  await expect(
    page.getByRole('main').locator('ol > li').nth(3).getByTestId('lesson-resource-chip'),
  ).toContainText(HUARD);
  await query(`update public.unit_lessons set library_item_id = null where id = $1`, [lesson!.id]);
});
