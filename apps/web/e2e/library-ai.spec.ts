import { expect, test, type Page } from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems, insertReadyItem, query } from './db';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Créer avec l’IA » and « Créer les versions manquantes avec l’IA » (Phase 4, DECISIONS D-072
 * to D-074). Needs the worker running with AI_PROVIDER=fake (as in CI): nothing leaves the
 * machine. The school's AI switch is turned on here and put back afterwards; the resources the
 * spec creates are deleted.
 */
test.describe.configure({ mode: 'serial' });

const PREFIX = e2ePrefix('ia-');
/** B1.2, 3e année, Mathématiques (supabase/seed.sql). */
const B1_2 = '20000000-0000-4000-8000-000000030b12';
const ITEM_URL = /\/library\/items\/([0-9a-f-]{36})$/;
const LEVELS = ['Débutant', 'Intermédiaire', 'Avancé', 'Enrichi'];

let aiWasOn: boolean | null = null;
const created: string[] = [];

async function removeRequests() {
  await query(
    `delete from public.ai_jobs j using public.users u
     where j.user_id = u.id and u.email = $1 and j.feature in ('library_item', 'library_levels')`,
    [DEMO.teacher3],
  );
}

test.beforeAll(async () => {
  await removeRequests();
  const [school] = await query<{ ai_enabled: boolean }>(
    'select ai_enabled from public.schools where id = $1',
    [SEED.school],
  );
  aiWasOn = school!.ai_enabled;
  await query('update public.schools set ai_enabled = true where id = $1', [SEED.school]);
});

test.afterAll(async () => {
  await deleteLibraryItems({ ids: created, titlePrefix: PREFIX });
  await removeRequests();
  if (aiWasOn !== null) {
    await query('update public.schools set ai_enabled = $2 where id = $1', [SEED.school, aiWasOn]);
  }
  await closeDb();
});

/** The version picker's buttons on a resource page. */
const versionButton = (page: Page, label: string) =>
  page.getByRole('group').getByRole('button', { name: label, exact: true });

test('a teacher creates a worksheet with its levels and a faith link after checking what is sent', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await login(page, DEMO.teacher3);
  await page.goto('/library/generate');
  await expect(page.getByRole('heading', { name: 'Créer avec l’IA', level: 1 })).toBeVisible();

  await page
    .getByLabel('Type de ressource', { exact: true })
    .selectOption({ label: 'Fiche d’exercices' });
  const grade3 = page.getByRole('checkbox', { name: '3e année', exact: true });
  await grade3.check();
  await page.getByLabel('Matière', { exact: true }).selectOption({ label: 'Mathématiques' });
  // The attentes load for the grade and the subject.
  await page.getByRole('checkbox', { name: /^B1\.2 / }).check();
  // The board's levels are ticked; the faith link suggests a reference.
  await expect(
    page.getByRole('checkbox', { name: 'Créer aussi une version par niveau' }),
  ).toBeChecked();
  for (const level of LEVELS) {
    await expect(page.getByRole('checkbox', { name: level, exact: true })).toBeChecked();
  }
  await page.getByRole('checkbox', { name: 'Ajouter un lien avec la foi' }).check();
  await expect(page.getByLabel('Référence', { exact: true })).toBeVisible();
  // A student of the class, named in the note: replaced before anything is sent.
  await page.getByLabel(/^Précisions/).fill('Pour Samuel, des nombres simples.');

  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(page.getByText('Ce qui sera envoyé à l’IA')).toBeVisible();
  await expect(
    page
      .locator('mark')
      .filter({ hasText: /^Élève [A-Z]+$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText('1 nom remplacé.')).toBeVisible();
  // The demo pack already has an approved worksheet for B1.2.
  await expect(
    page.getByText('Des ressources approuvées existent déjà pour cette attente :'),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Ordonner des nombres jusqu’à 1.000/ }),
  ).toBeVisible();
  await expect(
    page.getByText('Avec des versions par niveau, la préparation prend quelques minutes.'),
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Envoyer à l’IA' }).click();
  // The job page follows the request, then opens the new draft.
  await page.waitForURL(ITEM_URL, { timeout: 120_000 });
  const itemId = ITEM_URL.exec(new URL(page.url()).pathname)![1]!;
  created.push(itemId);

  await expect(
    page.getByText('Brouillon créé par l’IA : relisez-le avant de l’utiliser ou de le partager.'),
  ).toBeVisible();
  await expect(versionButton(page, 'Version de base')).toBeVisible();
  for (const level of LEVELS) await expect(versionButton(page, level)).toBeVisible();
  // The faith link is listed with the details (« Foi »).
  await expect(page.getByText('Foi', { exact: true }).first()).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Samuel');
  await expectAccessible(page);

  const [item] = await query<{
    source: string;
    status: string;
    share_scope: string;
    requires_faith_review: boolean;
    faith_link: boolean;
    versions: number;
    content: string;
  }>(
    `select i.source::text, i.status::text, i.share_scope::text, i.requires_faith_review,
       coalesce(i.catholic_connection, '') <> '' and i.catholic_reference_id is not null faith_link,
       (select count(*)::int from public.library_item_versions v where v.item_id = i.id) versions,
       (select string_agg(v.content::text, ' ') from public.library_item_versions v
        where v.item_id = i.id) content
     from public.library_items i join public.users u on u.id = i.author_id
     where i.id = $1 and u.email = $2`,
    [itemId, DEMO.teacher3],
  );
  expect(item).toMatchObject({
    source: 'ai_generated',
    status: 'draft',
    share_scope: 'private',
    // The faith link (with its reference) is what needs the faith review; the sample content
    // itself is no prayer, so « Contient du contenu de foi » stays the author's to tick.
    requires_faith_review: true,
    faith_link: true,
    versions: 5,
  });
  expect(item!.content).not.toContain('Samuel');
  expect(item!.content).not.toMatch(/Élève [A-Z]\b/);
});

test('the missing levels of a resource are added from its page', async ({ page }) => {
  test.setTimeout(150_000);
  const itemId = await insertReadyItem({
    author: DEMO.teacher3,
    type: 'reading_passage',
    title: `${PREFIX} Texte sans niveaux`,
  });
  created.push(itemId);

  await login(page, DEMO.teacher3);
  await page.goto(`/library/items/${itemId}`);
  const open = page.getByRole('button', { name: 'Créer les versions manquantes avec l’IA' });
  const dialog = page.getByRole('dialog');
  // A click before the page is interactive is lost: retry until the dialog opens.
  await expect(async () => {
    if (!(await dialog.isVisible())) await open.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  for (const level of LEVELS) {
    await expect(dialog.getByRole('checkbox', { name: level, exact: true })).toBeChecked();
  }

  await dialog.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(
    dialog.getByText(
      'Voici exactement ce qui sera envoyé : la version de base et son corrigé, sans les noms des élèves et du personnel.',
    ),
  ).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Envoyer à l’IA' }).click();

  // The job page follows the request and comes back to the resource once the versions are written.
  await page.waitForURL(new RegExp(`/library/items/${itemId}$`), { timeout: 120_000 });
  for (const level of LEVELS) await expect(versionButton(page, level)).toBeVisible();
  await expect(open).toHaveCount(0);

  const [counts] = await query<{ versions: number; audits: number }>(
    `select (select count(*)::int from public.library_item_versions where item_id = $1) versions,
       (select count(*)::int from public.audit_log
        where entity_id = $1 and action = 'library_item.levels_generated') audits`,
    [itemId],
  );
  expect(counts).toEqual({ versions: 5, audits: 1 });
});

test('« Créer avec l’IA » from an attente starts with its grade, subject and attente', async ({
  page,
}) => {
  const [math] = await query<{ id: string }>(
    "select id from public.subjects where code = 'mat' and board_id is null",
  );
  await login(page, DEMO.teacher3);
  await page.goto(`/library/generate?exp=${B1_2}`);
  await expect(page.getByLabel('Matière', { exact: true })).toHaveValue(math!.id);
  await expect(page.getByRole('checkbox', { name: '3e année', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^B1\.2 / })).toBeChecked();
});

test('a library request that waits too long, or fails, speaks of the resource', async ({
  page,
}) => {
  const [huard] = await query<{ id: string }>(
    `select id from public.library_items where title = 'Le huard, oiseau des lacs'`,
  );
  const job = async (feature: string, status: string, input: object) =>
    (
      await query<{ id: string }>(
        `insert into public.ai_jobs (board_id, school_id, user_id, feature, input, status,
           error_code, created_at)
         select $1, $2, u.id, $4, $5::jsonb, $6::public.ai_job_status,
           case when $6 = 'failed' then 'aiError' end, now() - interval '20 minutes'
         from public.users u where u.email = $3
         returning id`,
        [SEED.board, SEED.school, DEMO.teacher3, feature, JSON.stringify(input), status],
      )
    )[0]!.id;
  // Queued without an event, so the worker never takes it: it only waits.
  const waiting = await job('library_levels', 'queued', { itemId: huard!.id, baseRevision: 1 });
  const failed = await job('library_item', 'failed', {});

  await login(page, DEMO.teacher3);
  await page.goto(`/library/generate/${waiting}`);
  await expect(page.getByText('C’est plus long que prévu.')).toBeVisible();
  await expect(
    page.getByText('La ressource n’a pas changé : revenez plus tard', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Votre texte n’est pas perdu', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Retour à la ressource' }).last()).toHaveAttribute(
    'href',
    `/library/items/${huard!.id}`,
  );
  await expectAccessible(page);

  await page.goto(`/library/generate/${failed}`);
  await expect(page.getByText('La ressource n’a pas pu être préparée.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reprendre la demande' })).toBeVisible();
  await expectAccessible(page);
});
