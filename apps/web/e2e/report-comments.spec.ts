import { addDays } from '@lynx/domain';
import { expect, test, type Page } from '@playwright/test';
import { SEED, closeDb, deleteLibraryItems, query } from './db';
import { DEMO_USER_IDS, bankItemId, deleteBankRequests, torontoToday } from './db-report-comments';
import { SEEDED_PERIODS, restoreReportPeriods, setReportPeriods } from './db-year-plan';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Commentaires de bulletin » (DECISIONS D-129 to D-135), desktop, as Isabelle (3e année).
 *
 * Slice S2, « Créer une banque avec l’IA » (D-132): a bank requested from curriculum labels only,
 * checked before sending (nothing about her students is sent), then her private draft. Needs the
 * worker running with AI_PROVIDER=fake (as in CI): nothing leaves the machine. The school's AI
 * switch is turned on here and put back afterwards; the banks and requests made here are deleted.
 *
 * Slice S3, « Bulletins » (D-130, D-135): comments composed in the browser from the demo bank,
 * copied, kept on the device in template form only (`{prénom}`, never a first name), never in any
 * request, and erased at sign-out or by the janitor; Paul's subjects; the reminder on
 * « Aujourd’hui ». The report periods changed here are put back.
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
  await restoreReportPeriods();
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
      /^Aucun renseignement sur vos élèves n’est envoyé\s:\sseulement l’année, la matière, les attentes choisies et vos précisions\.$/,
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

  // The note goes only once « J’ai vérifié » is ticked.
  await expect(page.getByTestId('bank-note-words')).toContainText(
    'Aucun mot avec majuscule à vérifier.',
  );
  await expect(page.getByRole('button', { name: 'Envoyer à l’IA' })).toBeDisabled();

  // « Modifier la demande » goes back to the form; the choices are still there. A title before a
  // name the app does not know blocks the request, as « Traduire en anglais (IA) » does.
  await page.getByRole('button', { name: 'Modifier la demande' }).click();
  await expect(page.getByRole('checkbox', { name: /^B1\.2 / })).toBeChecked();
  const note = page.getByLabel(/^Précisions/);
  await note.fill('Comme pour Samuel, insister sur la droite numérique. Merci à Mme Dupuis.');
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await expect(page.getByText('Renseignements personnels à retirer')).toBeVisible();
  await expect(
    page.getByText(/^Nom que l’application ne connaît pas, après un titre\s:\sMme Dupuis$/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Envoyer à l’IA' })).toBeDisabled();
  await page.getByRole('button', { name: 'Modifier la demande' }).click();
  await note.fill('Comme pour Samuel, insister sur la droite numérique.');
  await page.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  await page
    .getByRole('checkbox', {
      name: 'J’ai vérifié : mes précisions ne nomment personne et ne disent rien sur un élève en particulier.',
    })
    .check();
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

// ---------------------------------------------------------------------------------------
// Slice S3: « Bulletins »
// ---------------------------------------------------------------------------------------

const SENTINEL = 'ZZSENTINELLE';
const DRAFT_PREFIX = 'lynx-draft:report:';
const COMPOSER = `/classes/${SEED.class3}/bulletins`;

/** The report drafts on this browser, key and stored text. */
const reportDrafts = (page: Page) =>
  page.evaluate((prefix) => {
    const out: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith(prefix)) out.push([key, localStorage.getItem(key) ?? '']);
    }
    return out.sort();
  }, DRAFT_PREFIX);

/** Opens a student of the list; the editor shows her name. */
async function openStudent(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: /^Élèves/ })
    .getByRole('link', { name: new RegExp(`^${name}\\s`) })
    .click();
  await expect(page).toHaveURL(/#eleve-[0-9a-f-]{36}$/);
  const editor = page.getByRole('article');
  await expect(
    editor.getByRole('heading', { level: 3, name: new RegExp(`^${name}`) }),
  ).toBeVisible();
  return editor;
}

test('« Bulletins »: comments composed on the device from the demo bank, copied, never sent', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // Every request the page makes, with its address, headers and body.
  const sent: string[] = [];
  page.on('request', (request) => {
    sent.push(
      [
        request.method(),
        request.url(),
        JSON.stringify(request.headers()),
        request.postData() ?? '',
      ].join('\n'),
    );
  });
  const [math, french] = await query<{ id: string }>(
    `select id from public.subjects where code in ('mat', 'fra') and board_id is null
     order by code = 'mat' desc`,
  );

  await login(page, DEMO.teacher3);
  await page.goto(`/classes/${SEED.class3}/students`);
  await page.getByRole('link', { name: 'Bulletins', exact: true }).click();
  await page.waitForURL(/\/bulletins$/);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Commentaires de bulletin' }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/^Commentaires de bulletin · 3e année – Mme Tremblay/);
  await expect(page.getByTestId('device-notice')).toContainText(
    /^Vos commentaires restent sur cet appareil\. Ils ne sont jamais envoyés à nos serveurs ni à l’intelligence artificielle\. Ils seront effacés quand vous vous déconnecterez, ou au plus tard le \d+\S*\s\S+\s\d{4}\. Copiez-les dans le bulletin officiel\./,
  );
  // The homeroom teacher: the learning skills first, then her subjects.
  const subject = page.getByLabel('Matière', { exact: true });
  await expect(subject.locator('option').first()).toHaveText(
    'Habiletés d’apprentissage et habitudes de travail',
  );

  // « Bulletin scolaire — 1re étape », Mathématiques: the demo bank, approved by the board.
  await page.getByLabel('Période', { exact: true }).selectOption('term1');
  await subject.selectOption({ label: 'Mathématiques' });
  await page.getByRole('button', { name: 'Afficher', exact: true }).click();
  await page.waitForURL(new RegExp(`/bulletins\\?period=term1&subject=${math!.id}$`));
  await expect(page.getByLabel('Période', { exact: true }).locator('option:checked')).toHaveText(
    /^Bulletin scolaire — 1re étape \(2 sept\.–29 janv\.\) · saisie au plus tard le 5 févr\.$/,
  );
  await expect(
    page.getByText(/^Commentaires de bulletin\s:\sMathématiques, 3e année$/),
  ).toBeVisible();
  await expect(page.getByText('Approuvée par le conseil', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir la banque' })).toHaveAttribute(
    'href',
    `/library/items/${bankItemId('commentaires-mat-3e-bulletin')}`,
  );
  // B1.1 and B1.2 were taught (the seeded unit's lessons 1 and 4).
  await expect(page.getByText('Attentes enseignées pendant la période (2)')).toBeVisible();
  await expect(page.getByTestId('report-progress')).toHaveText(
    /^0 prêt · 0 commencé · 20 à faire$/,
  );

  // Aïcha, level 3, one strength: her name in the text, with its counter.
  let editor = await openStudent(page, 'Aïcha');
  await expect(editor.getByRole('heading', { level: 3, name: /^Aïcha/ })).toBeFocused();
  await editor.getByRole('radio', { name: 'Niveau 3' }).check();
  const strengths = editor.getByRole('group', { name: 'Points forts' });
  await strengths.getByRole('checkbox', { name: /^Aïcha lit, représente, compose/ }).check();
  const comment = editor.getByLabel('Commentaire', { exact: true });
  await expect(comment).toHaveValue(
    /^Aïcha lit, représente, compose et décompose des nombres jusqu’à 1\s000 de différentes façons/,
  );
  await expect(editor.getByText(/^\d+\s\/\s1\s000\scaractères$/)).toBeVisible();
  // The attentes not taught (B1.3, B2.3, B2.5) are folded away.
  await expect(
    editor.getByText(
      /^Autres entrées de la banque \(attentes non enseignées pendant la période\)\s:\s6$/,
    ),
  ).toBeVisible();

  // « Copier »: the comment as shown, with plain spaces (« 1 000 »).
  await editor.getByRole('button', { name: 'Copier', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Copié', exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe((await comment.inputValue()).replace(/[\u00a0\u202f]/g, ' '));
  expect(copied).toContain('1 000');
  expect(copied).not.toMatch(/[\u00a0\u202f]/);

  // « Féminin »: the entries' feminine texts, chosen per student.
  await editor.getByRole('radio', { name: 'Féminin' }).check();
  await strengths
    .getByRole('checkbox', { name: 'Aïcha est de plus en plus confiante en mathématiques.' })
    .check();
  // « de {prénom} » elides before Aïcha.
  await editor
    .getByRole('group', { name: 'Commentaires généraux' })
    .getByRole('checkbox', { name: /^Les progrès d’Aïcha en numération/ })
    .check();
  await expect(comment).toHaveValue(
    /^Aïcha lit, .* Aïcha est de plus en plus confiante en mathématiques\. Les progrès d’Aïcha en numération sont réguliers depuis le début de l’année\.$/,
  );

  // Youssef: « de Youssef » (Y then a vowel does not elide).
  editor = await openStudent(page, 'Youssef');
  await editor.getByRole('radio', { name: 'Niveau 2' }).check();
  await editor
    .getByRole('group', { name: 'Commentaires généraux' })
    .getByRole('checkbox', { name: /^Les progrès de Youssef en numération/ })
    .check();
  await expect(editor.getByLabel('Commentaire', { exact: true })).toHaveValue(
    'Les progrès de Youssef en numération sont réguliers depuis le début de l’année.',
  );
  await expect(page.getByTestId('report-progress')).toHaveText(
    /^2 prêts · 0 commencé · 18 à faire$/,
  );

  // Over the limit: said in words, in the list and under the comment.
  await page.getByLabel('Limite de caractères').fill('100');
  await page.getByLabel('Limite de caractères').press('Enter');
  await expect(
    page
      .getByRole('navigation', { name: /^Élèves/ })
      .getByRole('link', { name: /^Aïcha\sDépasse de \d+ caractères$/ }),
  ).toBeVisible();
  editor = await openStudent(page, 'Aïcha');
  await expect(editor.getByText(/^Dépasse la limite de \d+ caractères\.$/)).toBeVisible();
  await page.getByLabel('Limite de caractères').fill('1000');
  await page.getByLabel('Limite de caractères').press('Enter');
  await expect(editor.getByText(/Dépasse la limite/)).toHaveCount(0);
  await expectAccessible(page);

  // Edited by hand, then a new entry: the page asks before replacing the text.
  await comment.click();
  await comment.press('End');
  await comment.pressSequentially(` ${SENTINEL}`);
  await comment.press('Enter');
  await strengths.getByRole('checkbox', { name: /^Aïcha compare et ordonne/ }).check();
  await expect(
    editor.getByText(
      'Vous avez modifié le commentaire. Remplacer votre texte par les entrées choisies?',
    ),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Garder mon texte' }).click();
  await expect(comment).toHaveValue(new RegExp(`${SENTINEL}\\n?$`));

  // « Mes notes (sur cet appareil) », with the sentinel and her name; Enter in each field.
  await editor.locator('summary').filter({ hasText: 'Mes notes (sur cet appareil)' }).click();
  const notes = editor.getByLabel('Mes notes (sur cet appareil)');
  // A classmate's name, typed without its accent: stored as a token, back with the roster's spelling.
  await notes.fill(`${SENTINEL} Aïcha calcule vite avec LEA`);
  await notes.press('Enter');
  await page.getByLabel('Limite de caractères').press('Enter');

  // Another subject, then back, and a reload: the comment comes back from the device.
  await subject.selectOption({ label: 'Français' });
  await page.getByRole('button', { name: 'Afficher', exact: true }).click();
  // The student open stays open in the other subject.
  await page.waitForURL(new RegExp(`subject=${french!.id}#eleve-[0-9a-f-]{36}$`));
  await expect(
    page.getByRole('article').getByRole('heading', { level: 3, name: /^Aïcha/ }),
  ).toBeVisible();
  await expect(page.getByLabel('Matière', { exact: true }).locator('option:checked')).toHaveText(
    'Français',
  );
  await page.goBack();
  await page.waitForURL(new RegExp(`subject=${math!.id}`));
  await page.reload();
  editor = await openStudent(page, 'Aïcha');
  await expect(editor.getByLabel('Commentaire', { exact: true })).toHaveValue(
    new RegExp(`^Aïcha lit, .*${SENTINEL}`, 's'),
  );
  await expect(editor.getByLabel('Mes notes (sur cet appareil)')).toHaveValue(
    `${SENTINEL} Aïcha calcule vite avec Léa\n`,
  );

  // The sentinel never left the browser: in no address, header or body of any request.
  expect(sent.length).toBeGreaterThan(10);
  for (const request of sent) expect(request).not.toContain(SENTINEL);
  // The device holds the comments in template form: `{prénom}` and `{élève:…}`, never a first
  // name of the class.
  const drafts = await reportDrafts(page);
  expect(drafts.map(([key]) => key)).toEqual([
    `${DRAFT_PREFIX}${DEMO_USER_IDS.isabelle}:${SEED.class3}:term1`,
  ]);
  const stored = drafts[0]![1];
  expect(stored).toContain('{prénom}');
  expect(stored).toContain(SENTINEL);
  expect(stored).toMatch(/\{prénom\} calcule vite avec \{élève:[0-9a-f]{8}\}/);
  expect(stored).not.toMatch(/Aïcha|Youssef|\bL[ée]a\b|LEA/);

  // « Effacer mes commentaires de cette période sur cet appareil » asks first (axe on its dialog).
  await page
    .getByRole('button', { name: 'Effacer mes commentaires de cette période sur cet appareil' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    'Effacer les commentaires de 2 élèves sur cet appareil? Cette action est définitive.',
  );
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  expect(await reportDrafts(page)).toHaveLength(1);

  // Signing out erases them; signing back in finds none.
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.waitForURL(/\/login/);
  expect(await reportDrafts(page)).toEqual([]);
  await login(page, DEMO.teacher3);
  await page.goto(`${COMPOSER}?period=term1&subject=${math!.id}`);
  await expect(page.getByTestId('report-progress')).toHaveText(
    /^0 prêt · 0 commencé · 20 à faire$/,
  );
  expect(await reportDrafts(page)).toEqual([]);
});

test('the janitor removes another account’s report comments and expired ones, never hers for being unreadable', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  const draft = (expiresOn: string) =>
    JSON.stringify({
      value: {
        v: 1,
        expiresOn,
        limit: 1000,
        plainSpaces: true,
        students: {
          '10000000-0000-4000-8000-000000000001': {
            comments: { mat: { text: '{prénom} lit.' } },
          },
        },
      },
      savedAt: Date.now(),
    });
  const mine = `${DRAFT_PREFIX}${DEMO_USER_IDS.isabelle}:${SEED.class3}:progress`;
  const unreadable = `${DRAFT_PREFIX}${DEMO_USER_IDS.isabelle}:${SEED.class3}:term2`;
  const planted = {
    // Marc's comments, left on this browser without signing out.
    [`${DRAFT_PREFIX}${DEMO_USER_IDS.marc}:${SEED.class5}:term1`]: draft('2099-01-01'),
    // Hers, 60 days after the remise: expired.
    [`${DRAFT_PREFIX}${DEMO_USER_IDS.isabelle}:${SEED.class3}:term1`]: draft('2020-01-01'),
    // Hers, but unreadable: never deleted for that (a sign-out removes it).
    [unreadable]: '{pas du JSON',
    [mine]: draft('2099-01-01'),
  };
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, planted);
  await page.goto('/calendar');
  await expect(async () => {
    expect((await reportDrafts(page)).map(([key]) => key).sort()).toEqual(
      [mine, unreadable].sort(),
    );
  }).toPass();
  await page.evaluate(
    (keys) => keys.forEach((key) => localStorage.removeItem(key)),
    [mine, unreadable],
  );
});

test('Paul, a subject teacher: his subject first, then the learning skills', async ({ page }) => {
  await login(page, DEMO.rotary);
  await page.goto(COMPOSER);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Commentaires de bulletin' }),
  ).toBeVisible();
  const options = page.getByLabel('Matière', { exact: true }).locator('option');
  await expect(options.nth(0)).toHaveText('Éducation physique et santé');
  await expect(options.nth(1)).toHaveText('Habiletés d’apprentissage et habitudes de travail');
  await expect(page.locator('optgroup[label="Mes matières"] option')).toHaveText([
    'Éducation physique et santé',
  ]);
  // No bank for his subject: links to make one (with AI only where the school turned it on).
  await expect(page.getByTestId('no-bank')).toContainText(
    'Aucune banque de commentaires pour Éducation physique et santé, 3e année.',
  );
  await expect(page.getByRole('link', { name: 'Créer une banque', exact: true })).toHaveAttribute(
    'href',
    /^\/library\/new\?type=report_comments&grade=3&subject=[0-9a-f-]{36}$/,
  );
  await expectAccessible(page);
});

test('« Aujourd’hui » reminds of the saisie three weeks ahead, with a link to the period', async ({
  page,
}) => {
  const today = await torontoToday();
  const due = addDays(today, 7);
  await setReportPeriods(
    SEEDED_PERIODS.map((p) =>
      p.kind === 'term1'
        ? { ...p, due_on: due, issued_on: p.issued_on && p.issued_on < due ? due : p.issued_on }
        : p,
    ),
  );
  try {
    await login(page, DEMO.teacher3);
    await page.goto('/today');
    const reminder = page.getByTestId('report-reminder').filter({ hasText: '1re étape' });
    await expect(reminder).toContainText(
      /^Bulletin scolaire — 1re étape\s:\ssaisie au plus tard le \d+\S*\s[^\s.]+\.?Préparer/,
    );
    await expectAccessible(page);
    await reminder.getByRole('link', { name: 'Préparer mes commentaires' }).click();
    await page.waitForURL(`${COMPOSER}?period=term1`);
    await expect(page.getByLabel('Période', { exact: true })).toHaveValue('term1');
  } finally {
    await restoreReportPeriods();
  }
});
