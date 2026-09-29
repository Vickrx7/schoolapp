import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, closeDb, query } from './db';
import { DEMO, expectAccessible, login } from './helpers';

// Needs the worker running with AI_PROVIDER=fake (as in CI): nothing leaves the machine.
// A saved result is an ordinary library draft (DECISIONS D-073): it opens, is edited and is
// deleted in the library.

const TEXT =
  'Zoé observe un castor près de la rivière. Le castor construit un barrage avec des branches. ' +
  'Il vit en famille dans une hutte.';

const suffix = () => Date.now().toString().slice(-5);

test.afterAll(async () => {
  await closeDb();
});

/** A click before the page is interactive is lost: retry until the dialog opens. */
async function confirm(page: Page, trigger: Locator, button: string) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dialog.getByRole('button', { name: button }).click();
}

/** Fills and sends a request from the form, then waits for its page. */
async function sendRequest(page: Page, title: string, { level }: { level?: string } = {}) {
  await page.goto('/differentiate');
  await page.getByLabel('Titre').fill(title);
  await page.getByLabel('Texte, consignes ou activité').fill(TEXT);
  if (level) await page.getByLabel(level).check();
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await page.getByRole('button', { name: 'Envoyer à l’IA' }).click();
  await page.waitForURL(/\/differentiate\/[0-9a-f-]{36}$/);
}

/** A saved text's page in the library. */
const ITEM_URL = /\/library\/items\/[0-9a-f-]{36}$/;

/** Deletes the library resource whose page is open (« Supprimer » is offered on drafts). */
async function deleteItem(page: Page) {
  await confirm(page, page.getByRole('button', { name: 'Supprimer', exact: true }), 'Supprimer');
  await page.waitForURL(/\/library\/mine$/);
}

/** Removes a finished request from « Demandes récentes ». */
async function discardRequest(page: Page, title: string) {
  await page.goto('/differentiate');
  // Not the saved text of the same title, in the list below.
  const row = page
    .getByRole('listitem')
    .filter({ hasText: title })
    .filter({ has: page.getByRole('button', { name: 'Retirer' }) });
  await confirm(page, row.getByRole('button', { name: 'Retirer' }), 'Retirer');
  await expect(row).toHaveCount(0);
}

test('the principal turns AI on, then a teacher differentiates a text without names leaving', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);

  // AI is off until the direction turns it on.
  await login(page, DEMO.principal);
  await page.goto('/school');
  // Exact: « Désactiver l’IA » contains the same words.
  const enable = page.getByRole('button', { name: 'Activer l’IA', exact: true });
  const isOn = page.getByText('L’IA est activée.');
  // Wait for the AI card before deciding (it may already be on after a retry).
  await expect(enable.or(isOn)).toBeVisible();
  if (await enable.isVisible()) {
    const dialog = page.getByRole('dialog');
    // A click before the page is interactive is lost: retry until the dialog opens.
    await expect(async () => {
      if (!(await dialog.isVisible())) await enable.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByRole('button', { name: 'Activer l’IA' }).click();
  }
  await expect(page.getByText('L’IA est activée.')).toBeVisible();
  await expect(page.getByText('Utilisation ce mois-ci')).toBeVisible();
  await context.clearCookies();

  await login(page, DEMO.teacher3);
  await page.goto('/differentiate');
  await expect(page.getByRole('heading', { name: 'Texte différencié' })).toBeVisible();
  await expectAccessible(page);

  // A personal detail blocks the request before anything is sent.
  await page.getByLabel('Titre').fill('Le castor');
  await page
    .getByLabel('Texte, consignes ou activité')
    .fill(`${TEXT} Écrivez-moi à parent.zoe@example.com.`);
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(page.getByText('Renseignements personnels à retirer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Envoyer à l’IA' })).toBeDisabled();

  // Without it, the preview shows the student's name replaced.
  await page.getByRole('button', { name: 'Modifier le texte' }).click();
  await page.getByLabel('Texte, consignes ou activité').fill(TEXT);
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(page.locator('mark', { hasText: 'Élève A' })).toBeVisible();
  await expect(page.getByText('1 nom remplacé.')).toBeVisible();
  await page.getByRole('button', { name: 'Envoyer à l’IA' }).click();

  // The worker answers; names come back only on our side.
  await page.waitForURL(/\/differentiate\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Débutant' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Enrichi' })).toBeVisible();
  await expect(page.getByLabel('Texte', { exact: true }).last()).toHaveValue(
    /Zoé observe un castor/,
  );
  await page.getByText('Voir exactement ce qui a été envoyé').click();
  const sent = page.locator('details pre');
  await expect(sent).toContainText('Élève A observe un castor');
  await expect(sent).not.toContainText('Zoé');
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForURL(ITEM_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Le castor' })).toBeVisible();
  const badges = page.getByRole('list', { name: 'Caractéristiques de la ressource' });
  await expect(badges).toContainText('Brouillon');
  await expect(badges).toContainText('IA');

  // « Mes textes différenciés » opens it in the library (the recent requests still link to the
  // request itself).
  await page.goto('/differentiate');
  const savedTexts = page.getByRole('list', { name: 'Mes textes différenciés' });
  await expect(savedTexts.getByRole('link', { name: 'Le castor' }).first()).toHaveAttribute(
    'href',
    /^\/library\/items\/[0-9a-f-]{36}$/,
  );
});

test('a teacher adds a language level of their own', async ({ page }) => {
  await login(page, DEMO.teacher5);
  await page.goto('/differentiate/levels');
  const name = `Accueil ${Date.now().toString().slice(-5)}`;
  await page.getByLabel('Nom du niveau').last().fill(name);
  await page.getByLabel('Description pour l’IA').last().fill('Mots très simples et images.');
  await page.getByRole('button', { name: 'Ajouter un niveau' }).click();
  await expect(page.getByText('Niveau ajouté.')).toBeVisible();
  await page.goto('/differentiate');
  await expect(page.getByText(name)).toBeVisible();
});

// The tests below need AI on for the demo school (the first test turns it on).

test('a failed request keeps the teacher’s text', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, DEMO.teacher3);
  // The fake AI repeats the title in every version, and a level name in a title is refused
  // (students must not see it): this request always fails, after three attempts.
  const title = `Le castor, niveau Débutant ${suffix()}`;
  await sendRequest(page, title);
  await expect(page.getByText('La demande n’a pas pu être complétée.')).toBeVisible({
    timeout: 30_000,
  });
  await expectAccessible(page);

  // The form comes back filled from the request itself (on any device)...
  await page.getByRole('link', { name: 'Reprendre ce texte' }).click();
  await page.waitForURL(/\/differentiate\?from=/);
  await expect(page.getByLabel('Titre')).toHaveValue(title);
  await expect(page.getByLabel('Texte, consignes ou activité')).toHaveValue(TEXT);

  // ...and the draft on this device was kept too: sending it didn't throw it away.
  await page.goto('/differentiate');
  await expect(
    page.getByText('Votre dernière demande n’a pas abouti : son texte a été récupéré.'),
  ).toBeVisible();
  await expect(page.getByLabel('Titre')).toHaveValue(title);
  await expect(page.getByLabel('Texte, consignes ou activité')).toHaveValue(TEXT);
  await page.getByRole('button', { name: 'Effacer le brouillon' }).click();
  await expect(page.getByLabel('Titre')).toHaveValue('');

  await discardRequest(page, title);
});

test('a long text asks for fewer levels before anything is sent', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/differentiate');
  await page.getByLabel('Titre').fill(`Le long castor ${suffix()}`);
  // About 8,000 characters: too long for the four levels checked by default.
  await page
    .getByLabel('Texte, consignes ou activité')
    .fill('Le castor construit un barrage avec des branches. '.repeat(160));
  const check = page.getByRole('button', { name: 'Vérifier avant d’envoyer' });
  await check.click();
  await expect(
    page.getByText(
      'Ce texte est trop long pour autant de niveaux. Raccourcissez-le ou choisissez moins de niveaux.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Envoyer à l’IA' })).toHaveCount(0);

  // With two levels, the same text can go.
  await page.getByLabel('Avancé').uncheck();
  await page.getByLabel('Enrichi').uncheck();
  await check.click();
  await expect(page.getByRole('button', { name: 'Envoyer à l’IA' })).toBeVisible();
});

test('saving a result says what to fix instead of doing nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, DEMO.teacher3);
  const title = `Le castor ${suffix()}`;
  await sendRequest(page, title);
  await expect(page.getByRole('heading', { name: 'Débutant' })).toBeVisible({ timeout: 30_000 });

  // Opening a result stores nothing, so the next visit doesn't claim a draft was restored.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Débutant' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Brouillon non enregistré récupéré.')).toHaveCount(0);

  // A dash instead of « : » makes the whole line a word, longer than a word may be.
  const glossary = page.getByLabel('Glossaire').first();
  await glossary.fill(
    'castor : animal\n' +
      'castor — animal qui construit des barrages avec des branches, de la boue et des pierres près des rivières',
  );
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Ligne 2 : Ce texte est trop long.')).toBeVisible();
  await expect(page).toHaveURL(/\/differentiate\/[0-9a-f-]{36}$/);

  // Phones show one level at a time: the level tabs are full-size tap targets.
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByRole('group', { name: 'Niveaux' }).getByRole('button');
  await expect(tabs.first()).toBeVisible();
  for (const tab of await tabs.all()) {
    expect((await tab.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByText('Ligne 2 : Ce texte est trop long.')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  await glossary.fill('castor : animal qui construit des barrages');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForURL(ITEM_URL);
  const itemUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // Changes are made in the library's editor and kept: the title and a level's glossary, read
  // back from the database.
  await page.getByRole('link', { name: 'Modifier' }).click();
  await page.waitForURL(/\/edit$/);
  await page.getByLabel('Titre', { exact: true }).fill(`${title} révisé`);
  const definition = page
    .getByRole('region', { name: 'Version : Débutant' })
    .getByRole('group', { name: 'Mot 1' })
    .getByLabel('Définition (facultatif)');
  await expect(async () => {
    await page.getByRole('button', { name: 'Débutant', exact: true }).click();
    await expect(definition).toHaveValue('animal qui construit des barrages', { timeout: 1000 });
  }).toPass();
  await definition.fill('rongeur qui construit des barrages');
  const saveBar = page.getByTestId('library-save-bar');
  await saveBar.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(saveBar.getByText(/^Enregistré à /)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Débutant', exact: true }).click();
  await expect(definition).toHaveValue('rongeur qui construit des barrages');
  await page.goto(itemUrl);
  await expect(page.getByRole('heading', { level: 1, name: `${title} révisé` })).toBeVisible();

  await deleteItem(page);
  await discardRequest(page, title);
});

test('another account on the same computer never gets a draft', async ({ page, context }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/differentiate');
  await page.getByLabel('Titre').fill('Brouillon d’Isabelle');
  await page.getByLabel('Texte, consignes ou activité').fill(TEXT);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) => k.startsWith('lynx-draft:differentiate:new:'))
            .length,
      ),
    )
    .toBe(1);
  await context.clearCookies();

  await login(page, DEMO.teacher5);
  await page.goto('/differentiate');
  await expect(page.getByRole('heading', { name: 'Texte différencié' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Brouillon non enregistré récupéré.')).toHaveCount(0);
  await expect(page.getByLabel('Titre')).toHaveValue('');
  await expect(page.getByLabel('Texte, consignes ou activité')).toHaveValue('');
});

test('signing out removes the drafts from this computer', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/differentiate');
  await page.getByLabel('Titre').fill('Brouillon à effacer');
  await page.getByLabel('Texte, consignes ou activité').fill(TEXT);
  const drafts = () =>
    page.evaluate(
      () => Object.keys(localStorage).filter((k) => k.startsWith('lynx-draft:')).length,
    );
  await expect.poll(drafts).toBe(1);

  await page.goto('/profile');
  // Wait until the page is interactive: the drafts are removed by the page's own script.
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForURL(/\/login/);
  await expect.poll(drafts).toBe(0);
});

test('a level used by a request or a saved text is kept until nothing uses it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, DEMO.teacher5);
  await page.goto('/differentiate/levels');
  const name = `Accueil ${suffix()}`;
  await page.getByLabel('Nom du niveau').last().fill(name);
  await page.getByLabel('Description pour l’IA').last().fill('Mots très simples et images.');
  await page.getByRole('button', { name: 'Ajouter un niveau' }).click();
  await expect(page.getByText('Niveau ajouté.')).toBeVisible();

  const title = `Le hibou ${suffix()}`;
  await sendRequest(page, title, { level: name });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
  const result = page.url();

  // Deleting it now would make the result impossible to save.
  const inUse = page.getByText(
    'Ce niveau sert encore à une demande récente ou à un texte enregistré. Décochez « Actif » pour le masquer plutôt.',
  );
  await page.goto('/differentiate/levels');
  const row = page.locator('li').filter({ has: page.locator(`input[value="${name}"]`) });
  await confirm(page, row.getByRole('button', { name: 'Supprimer' }), 'Supprimer');
  await expect(inUse).toBeVisible();

  await page.goto(result);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForURL(ITEM_URL);
  // The level's version, among the resource's versions.
  const levelChip = page.getByRole('button', { name: `${name} (niveau personnel)`, exact: true });
  await expect(levelChip).toBeVisible();
  const saved = page.url();

  // Without the request, the saved text still holds it: deleting it would drop that version.
  await discardRequest(page, title);
  await page.goto('/differentiate/levels');
  await confirm(page, row.getByRole('button', { name: 'Supprimer' }), 'Supprimer');
  await expect(inUse).toBeVisible();
  await page.goto(saved);
  await expect(levelChip).toBeVisible();

  // Once nothing uses it, it can go.
  await deleteItem(page);
  await page.goto('/differentiate/levels');
  await confirm(page, row.getByRole('button', { name: 'Supprimer' }), 'Supprimer');
  await expect(page.getByText('Niveau supprimé.')).toBeVisible();
});

test('without the Library module, a saved text still opens, prints and is deleted', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const libraryModule = (enabled: boolean) =>
    query(
      `update public.module_entitlements set enabled = $2 where school_id = $1 and module = 'library'`,
      [SEED.school, enabled],
    );
  await login(page, DEMO.teacher5);
  const title = `La marmotte ${suffix()}`;
  await sendRequest(page, title);
  await expect(page.getByRole('heading', { name: 'Débutant' })).toBeVisible({ timeout: 30_000 });
  try {
    await libraryModule(false);
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.waitForURL(ITEM_URL);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    // Nothing else of the library: no « Ressources », no editor, no workflow.
    const nav = page.getByRole('navigation', { name: 'Navigation principale' }).first();
    await expect(nav.getByRole('link', { name: 'Ressources' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'J’ai révisé cette ressource' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Texte différencié' }).first()).toHaveAttribute(
      'href',
      '/differentiate',
    );
    await expectAccessible(page);
    const itemUrl = page.url();

    // « Mes textes différenciés » leads to it, and it prints.
    await page.goto('/differentiate');
    await page
      .getByRole('list', { name: 'Mes textes différenciés' })
      .getByRole('link', { name: title })
      .click();
    await page.waitForURL(ITEM_URL);
    await page.goto(`${itemUrl}/print?doc=student`);
    await expect(
      page.getByTestId('print-sheets').getByTestId('sheet-number').first(),
    ).toBeVisible();

    // « Supprimer » takes it away and goes back to « Texte différencié ».
    await page.goto(itemUrl);
    await confirm(page, page.getByRole('button', { name: 'Supprimer', exact: true }), 'Supprimer');
    await page.waitForURL(/\/differentiate$/);
    const [row] = await query<{ count: number }>(
      `select count(*)::int as count from public.library_items where title = $1`,
      [title],
    );
    expect(row?.count).toBe(0);
  } finally {
    await libraryModule(true);
  }
  await discardRequest(page, title);
});
