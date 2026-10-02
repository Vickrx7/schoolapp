import { expect, test } from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems, query } from './db';
import { deleteBankRequests } from './db-report-comments';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Commentaires de bulletin » (DECISIONS D-129 to D-135), desktop, as Isabelle (3e année).
 *
 * Slice S2, « Créer une banque avec l’IA » (D-132): a bank requested from curriculum labels only,
 * checked before sending (nothing about her students is sent), then her private draft. Needs the
 * worker running with AI_PROVIDER=fake (as in CI): nothing leaves the machine. The school's AI
 * switch is turned on here and put back afterwards; the banks and requests made here are deleted.
 */
test.describe.configure({ mode: 'serial' });

/** B1.1 and B1.2, 3e année, Mathématiques (supabase/seed.sql). */
const B1_1 = '20000000-0000-4000-8000-000000030b11';
const B1_2 = '20000000-0000-4000-8000-000000030b12';
const ITEM_URL = /\/library\/items\/([0-9a-f-]{36})$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

let aiWasOn: boolean | null = null;
const created: string[] = [];

test.beforeAll(async () => {
  await deleteBankRequests(DEMO.teacher3);
  const [school] = await query<{ ai_enabled: boolean }>(
    'select ai_enabled from public.schools where id = $1',
    [SEED.school],
  );
  aiWasOn = school!.ai_enabled;
  await query('update public.schools set ai_enabled = true where id = $1', [SEED.school]);
});

test.afterAll(async () => {
  await deleteLibraryItems({ ids: created });
  await deleteBankRequests(DEMO.teacher3);
  if (aiWasOn !== null) {
    await query('update public.schools set ai_enabled = $2 where id = $1', [SEED.school, aiWasOn]);
  }
  await closeDb();
});

test('« Créer une banque avec l’IA »: checked before sending, no student data, a private draft', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await login(page, DEMO.teacher3);
  // From the library hub, next to « Créer avec l’IA ».
  await page.goto('/library');
  await page.getByRole('link', { name: /^Créer une banque de commentaires \(IA\)/ }).click();
  await page.waitForURL(/\/library\/generate\/comments$/);
  await expect(
    page.getByRole('heading', { name: 'Créer une banque avec l’IA', level: 1 }),
  ).toBeVisible();

  // Her grade is chosen; a subject's report card bank by default.
  await expect(page.getByRole('radio', { name: 'Une matière' })).toBeChecked();
  await expect(page.getByLabel('Année d’études', { exact: true })).toHaveValue('3');
  await expect(
    page.getByRole('radio', { name: 'Bulletin scolaire (1re et 2e étapes)' }),
  ).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Moyennes (400 caractères)' })).toBeChecked();
  await page.getByLabel('Matière', { exact: true }).selectOption({ label: 'Mathématiques' });
  // The attentes load for the grade and the subject, by domaine.
  await page.getByRole('checkbox', { name: /^B1\.1 / }).check();
  await page.getByRole('checkbox', { name: /^B1\.2 / }).check();
  await expect(page.getByText('2 attentes choisies sur 12.')).toBeVisible();
  // A student of the class, named in the note: replaced before anything is sent.
  await page.getByLabel(/^Précisions/).fill('Comme pour Samuel, insister sur la droite numérique.');

  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(page.getByText('Ce qui sera envoyé à l’IA')).toBeVisible();
  await expect(
    page.getByText(
      /^Aucun renseignement sur vos élèves n’est envoyé\s:\sseulement l’année, la matière et les attentes choisies\.$/,
    ),
  ).toBeVisible();
  // Exactly what is sent: the grade, the subject, the report, the attentes with their keys, the
  // length and the de-identified note; no school, class, student or id.
  const sent = page.locator('pre');
  await expect(sent).toContainText("Année d'études : 3e année");
  await expect(sent).toContainText('Matière : Mathématiques');
  await expect(sent).toContainText('Bulletin : Bulletin scolaire (1re et 2e étapes)');
  await expect(sent).toContainText('- E1 — B1.1');
  await expect(sent).toContainText('- E2 — B1.2');
  await expect(sent).toContainText('au plus 400 caractères par texte');
  await expect(sent.locator('mark').filter({ hasText: /^Élève [A-Z]+$/ })).toHaveCount(1);
  const text = (await sent.textContent()) ?? '';
  expect(text).not.toMatch(/Samuel|Tremblay|Isabelle|Saint-Exemple|Gagnon/);
  expect(text).not.toMatch(UUID);
  await expect(page.getByText('1 nom remplacé.')).toBeVisible();
  await expect(page.getByText('Relisez chaque entrée avant de l’utiliser.')).toBeVisible();
  await expectAccessible(page);

  // « Modifier la demande » goes back to the form; the choices are still there.
  await page.getByRole('button', { name: 'Modifier la demande' }).click();
  await expect(page.getByRole('checkbox', { name: /^B1\.2 / })).toBeChecked();
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await page.getByRole('button', { name: 'Envoyer à l’IA' }).click();
  // The job page follows the request, then opens the new draft.
  await page.waitForURL(ITEM_URL, { timeout: 120_000 });
  const itemId = ITEM_URL.exec(new URL(page.url()).pathname)![1]!;
  created.push(itemId);

  await expect(
    page.getByText('Brouillon créé par l’IA : relisez-le avant de l’utiliser ou de le partager.'),
  ).toBeVisible();
  await expect(page.getByText('Banque de commentaires de bulletin').first()).toBeVisible();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: 'Attente B1.1' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Attente B1.2' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Points forts' }).first()).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Prochaines étapes' }).first()).toBeVisible();
  await expect(panel).toContainText(/Niveau 3 · Mise en application\s:\s\{prénom\} réussit/);
  await expect(page.locator('main')).not.toContainText('Samuel');
  await expect(page.locator('main')).not.toContainText(/Élève [A-Z]\b/);
  await expectAccessible(page);

  const [item] = await query<{
    type: string;
    source: string;
    status: string;
    share_scope: string;
    duration_minutes: number | null;
    expectations: string[];
    entries: number;
    sent_text: string;
  }>(
    `select i.type::text, i.source::text, i.status::text, i.share_scope::text, i.duration_minutes,
       (select array_agg(e.expectation_id::text order by e.expectation_id)
          from public.library_item_expectations e where e.item_id = i.id) expectations,
       (select jsonb_array_length(v.content -> 'entries') from public.library_item_versions v
          where v.item_id = i.id) entries,
       (select j.sent_text from public.ai_jobs j where j.result ->> 'itemId' = i.id::text) sent_text
     from public.library_items i join public.users u on u.id = i.author_id
     where i.id = $1 and u.email = $2`,
    [itemId, DEMO.teacher3],
  );
  expect(item).toMatchObject({
    type: 'report_comments',
    source: 'ai_generated',
    status: 'draft',
    share_scope: 'private',
    duration_minutes: null,
    expectations: [B1_1, B1_2].sort(),
  });
  expect(item!.entries).toBeGreaterThanOrEqual(16);
  expect(item!.sent_text).toContain('Comme pour Élève A, insister sur la droite numérique.');
  expect(item!.sent_text).not.toMatch(/Samuel|Tremblay/);
});

test('a request being prepared, a failed one taken up again, and the links to the form', async ({
  page,
}) => {
  const [subject] = await query<{ id: string }>(
    "select id from public.subjects where code = 'mat' and board_id is null",
  );
  const input = {
    itemType: 'report_comments',
    scope: 'subject',
    period: 'progress',
    length: 'short',
    gradeCodes: ['3'],
    gradeLabels: ['3e année'],
    subjectId: subject!.id,
    subjectLabel: 'Mathématiques',
    expectations: [
      {
        key: 'E1',
        expectationId: B1_2,
        code: 'B1.2',
        text: 'Comparer et ordonner des nombres naturels jusqu’à 1 000.',
        kind: 'specific',
        strandLabel: 'Nombres',
      },
    ],
    teacherNote: 'Des phrases courtes.',
  };
  const job = async (status: string) =>
    (
      await query<{ id: string }>(
        `insert into public.ai_jobs (board_id, school_id, user_id, feature, input, status,
           error_code, created_at)
         select $1, $2, u.id, 'report_comment_bank', $4::jsonb, $5::public.ai_job_status,
           case when $5 = 'failed' then 'invalidOutput' end, now() - interval '1 minute'
         from public.users u where u.email = $3
         returning id`,
        [SEED.board, SEED.school, DEMO.teacher3, JSON.stringify(input), status],
      )
    )[0]!.id;
  // Queued without an event, so the worker never takes it: it only waits.
  const waiting = await job('queued');
  const failed = await job('failed');

  await login(page, DEMO.teacher3);
  await page.goto('/library');
  await expect(page.getByText('En préparation', { exact: true }).first()).toBeVisible();
  await page
    .getByRole('link', { name: /^Banque de commentaires de bulletin\s:\sen préparation$/ })
    .click();
  await page.waitForURL(`/library/generate/${waiting}`);
  await expect(
    page.getByRole('heading', { name: 'Préparation de la banque de commentaires', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText('L’IA prépare la banque de commentaires (quelques minutes).'),
  ).toBeVisible();
  await expectAccessible(page);

  await page.goto(`/library/generate/${failed}`);
  await expect(page.getByText('La banque de commentaires n’a pas pu être préparée.')).toBeVisible();
  await page.getByRole('link', { name: 'Reprendre la demande' }).last().click();
  await page.waitForURL(`/library/generate/comments?resume=${failed}`);
  await expect(page.getByText('Voici votre demande précédente.', { exact: false })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Bulletin de progrès' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Courtes (250 caractères)' })).toBeChecked();
  await expect(page.getByLabel('Matière', { exact: true })).toHaveValue(subject!.id);
  await expect(page.getByRole('checkbox', { name: /^B1\.2 / })).toBeChecked();
  await expect(page.getByLabel(/^Précisions/)).toHaveValue('Des phrases courtes.');
  await expectAccessible(page);

  // The learning skills take no subject and no attente.
  await page
    .getByRole('radio', { name: 'Les habiletés d’apprentissage et habitudes de travail' })
    .check();
  await expect(page.getByLabel('Matière', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^La banque porte sur les six habiletés/)).toBeVisible();

  // « Créer avec l’IA » sends a comment bank here.
  await page.goto('/library/generate');
  await page.getByRole('link', { name: 'Créer une banque avec l’IA' }).click();
  await page.waitForURL(/\/library\/generate\/comments$/);
  // A link with ids only (« Bulletins », slice S3) prefills the form.
  await page.goto(
    `/library/generate/comments?scope=subject&grade=3&subject=${subject!.id}&period=progress&exp=${B1_1},${B1_2}`,
  );
  await expect(page.getByRole('radio', { name: 'Bulletin de progrès' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^B1\.1 / })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^B1\.2 / })).toBeChecked();
});
