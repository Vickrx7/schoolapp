import { readFile } from 'node:fs/promises';
import { seedItemId } from '@lynx/content';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  auditCountBy,
  cleanupAbsences,
  clearAttempts,
  closeDb,
  dbNow,
  deleteAlertsFor,
  deleteSampleClasses,
  deleteStaff,
  openCodeWindow,
  planIdOn,
  query,
  resetLanguage,
  SEED,
} from './db';
import {
  acceptWelcome,
  addDaysIso,
  DEMO,
  expectAccessible,
  isSeededSchoolDay,
  login,
  reportAbsence,
} from './helpers';

/**
 * The board demo, step by step as `docs/demo-script.md` tells it (DECISIONS D-120): the privacy
 * promise; Isabelle's « Aujourd'hui »; an absence and its plan; a code from the office and the
 * substitute, whose alert reveal is logged; the end-of-day report; « Ressources » and « Texte
 * différencié » (fake AI); « Présenter à la classe »; the direction's dashboard; « Journal
 * d'audit » with the office-issued flag and its CSV; « Conseil »: « État du système », an
 * invitation, and the new teacher's « Bienvenue » and sample class. Step 11 (hosting) is a slide.
 *
 * If the script changes, this spec changes with it. It runs on the lite stack (or the CLI stack
 * in CI) with the worker on AI_PROVIDER=fake, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The
 * absence is for the next school day, so the script's « 6 h » works whatever the time of the run;
 * everything the demo creates is removed at the end.
 */
test.describe.configure({ mode: 'serial' });

/** Isabelle's alert for Samuel (encrypted by the web server, revealed by the substitute). */
const ALERT = 'Allergie aux arachides, auto-injecteur dans le sac (démonstration)';
const BEHAVIOUR = 'Très bonne journée; le groupe a bien travaillé (démonstration).';
const AI_TITLE = `Le castor (démonstration ${Date.now().toString(36)})`;
const AI_TEXT =
  'Zoé observe un castor près de la rivière. Le castor construit un barrage avec des branches. ' +
  'Il vit en famille dans une hutte.';
const QUIZ = {
  id: seedItemId('demo', 'quiz-nombres-1000'),
  title: 'Quiz : les nombres jusqu’à 1 000',
};
const INVITEE = {
  email: `demo-${Date.now().toString(36)}@demo.lynx.test`,
  name: 'Chantal Démo',
};

/** The school's date (America/Toronto), as YYYY-MM-DD. */
const schoolToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());

/** The next school day after today: the absence's day, whatever the time of the run. */
function nextSchoolDay(): string {
  let day = addDaysIso(schoolToday(), 1);
  while (!isSeededSchoolDay(day)) day = addDaysIso(day, 1);
  return day;
}

const DEMO_DAY = nextSchoolDay();

let isabelle: BrowserContext;
let julie: BrowserContext;
let substitute: BrowserContext;
let sophie: BrowserContext;
let teacher: Page;
let office: Page;
let sub: Page;
let principal: Page;
let absenceId = '';
let planId = '';
let code = '';
let aiWasEnabled = false;

async function newContext(browser: Browser): Promise<BrowserContext> {
  const use = test.info().project.use;
  return browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    timezoneId: use.timezoneId,
    viewport: use.viewport,
  });
}

/** Clicks until `then` shows: a tap before the page is interactive is lost. */
async function clickUntil(button: Locator, then: Locator) {
  await expect(async () => {
    if (!(await then.isVisible())) await button.click();
    await expect(then).toBeVisible({ timeout: 1500 });
  }).toPass();
}

/** A choice chip (a radio button drawn as a button). */
const chipIn = (scope: Locator, name: string) =>
  scope.locator('label').filter({ hasText: new RegExp(`^${name}$`) });

/** The office's (and direction's) card for Isabelle's day. */
const boardRow = (page: Page) =>
  page.getByTestId('sub-day-row').filter({ hasText: 'Mme Tremblay' });

async function removeDemoData() {
  await cleanupAbsences(DEMO.teacher3);
  await deleteAlertsFor('Samuel', SEED.class3);
  await clearAttempts();
  await query(
    `delete from public.ai_jobs j using public.users u
     where j.user_id = u.id and u.email = $1 and j.input ->> 'title' like 'Le castor (démonstration %'`,
    [DEMO.teacher3],
  );
  await deleteSampleClasses(INVITEE.email);
  await deleteStaff(INVITEE.email);
}

test.beforeAll(async ({ browser }) => {
  await removeDemoData();
  // The demo reads the French screens (language.spec.ts changes the office's saved language).
  await resetLanguage(DEMO.office);
  // « Texte différencié » needs AI at the school: the principal turns it on in « École »
  // before the demo (the script says so). Put back as it was at the end.
  const [school] = await query<{ ai_enabled: boolean }>(
    'select ai_enabled from public.schools where id = $1',
    [SEED.school],
  );
  aiWasEnabled = school!.ai_enabled;
  if (!aiWasEnabled) {
    await query('update public.schools set ai_enabled = true where id = $1', [SEED.school]);
  }

  isabelle = await newContext(browser);
  teacher = await isabelle.newPage();
  await login(teacher, DEMO.teacher3);
  // Before the demo: an alert for Samuel, as Isabelle records it (encrypted by the server).
  await teacher.goto(`/classes/${SEED.class3}/students`);
  await clickUntil(
    teacher.getByRole('button', { name: 'Alerte de sécurité ou médicale' }),
    teacher.getByRole('button', { name: 'Ajouter une alerte' }).first(),
  );
  const row = teacher
    .getByRole('listitem')
    .filter({ has: teacher.locator('input[value="Samuel"]') });
  await row.getByRole('button', { name: 'Ajouter une alerte' }).click();
  await row.getByLabel('Description').fill(ALERT);
  await row.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(teacher.getByText('Alerte enregistrée.')).toBeVisible();
});

test.afterAll(async () => {
  await Promise.all([isabelle?.close(), julie?.close(), substitute?.close(), sophie?.close()]);
  await removeDemoData();
  if (!aiWasEnabled) {
    await query('update public.schools set ai_enabled = false where id = $1', [SEED.school]);
  }
  await closeDb();
});

test('1. The privacy promise: « Confidentialité et conditions »', async ({ page }) => {
  await page.goto('/confidentialite');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Confidentialité et conditions' }),
  ).toBeVisible();
  for (const section of ['Ce que l’application recueille', 'L’intelligence artificielle']) {
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
  }
  // The AI paragraph states its limit: names the app does not know are the teacher's to remove.
  await expect(page.getByText(/Elle ne reconnaît pas les autres noms/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Où sont les données' })).toBeVisible();
  await expect(page.getByText(/sont au Canada/)).toBeVisible();
  await expectAccessible(page);
});

test('2. Isabelle’s « Aujourd’hui »', async () => {
  // The day of the demo (« Aujourd'hui » with a date shows that day).
  await teacher.goto(`/today?date=${DEMO_DAY}`);
  await expect(teacher.getByRole('link', { name: 'Revenir à aujourd’hui' })).toBeVisible();
  await expect(teacher.getByRole('link', { name: 'Je suis absent·e' })).toBeVisible();
  await expect(teacher.getByText('Entrée, prière du matin et O Canada').first()).toBeVisible();
  await expect(teacher.getByText(/^Prochaine leçon ·/).first()).toBeVisible();
  // The footer: privacy, release notes and the version.
  await expect(teacher.getByRole('link', { name: 'Confidentialité' })).toBeVisible();
  await expect(teacher.getByRole('link', { name: 'Nouveautés' })).toBeVisible();
  await expectAccessible(teacher);
});

test('3. 6 h: Isabelle is sick; the plan is ready before anyone arrives', async () => {
  await reportAbsence(teacher, { startsOn: DEMO_DAY });
  absenceId = /\/absences\/([0-9a-f-]{36})$/.exec(teacher.url())![1]!;
  planId = await planIdOn(absenceId, DEMO_DAY);
  await expect(teacher.getByTestId('plan-status').first()).toContainText(
    'Prêt · publié automatiquement',
  );

  // « Réviser le plan »: the day's lessons, the groups by first name, the office's phone.
  await teacher.getByRole('link', { name: 'Réviser le plan' }).first().click();
  await teacher.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
  await expect(teacher.getByText('Entrée, prière du matin et O Canada')).toBeVisible();
  await expect(teacher.getByTestId('plan-group').filter({ hasText: 'Samuel' })).toBeVisible();
  await expect(teacher.getByTestId('plan-contacts')).toContainText('555-0100');
  await expectAccessible(teacher);

  // Released now rather than at 7:30, for the rest of the demo.
  await teacher.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect(teacher.getByTestId('plan-status').first()).toHaveText('Publié');
});

test('4. The office gives a code; the substitute reads the day and reveals the alert (logged)', async ({
  browser,
}) => {
  julie = await newContext(browser);
  office = await julie.newPage();
  await login(office, DEMO.office);
  await expect(office).toHaveURL(/\/absences$/);
  await office.goto(`/absences?date=${DEMO_DAY}`);
  const row = boardRow(office);
  await expect(row.getByTestId('board-status')).toContainText('Publié');
  await expect(row).toContainText('3e année – Mme Tremblay');
  await clickUntil(
    row.getByRole('button', { name: 'Générer un code' }),
    office.getByTestId('sub-code'),
  );
  code = (await office.getByTestId('sub-code').textContent())!.trim();
  const dialog = office.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'Texto' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Imprimer la feuille d’accueil' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(row).toContainText('1 code actif');

  // The substitute, on her phone, without an account. (The code works on its day; the run
  // opens its window now.)
  await openCodeWindow(planId);
  substitute = await newContext(browser);
  sub = await substitute.newPage();
  await sub.goto('/s');
  await sub.waitForURL(/\/suppleance$/);
  await expect(
    sub.getByText(
      'En utilisant ce code, vous accédez à des renseignements confidentiels réservés à cette journée ; chaque consultation est enregistrée.',
    ),
  ).toBeVisible();
  await sub.getByLabel('Code d’accès').fill(code.toLowerCase());
  await sub.getByRole('button', { name: 'Commencer' }).click();
  await sub.waitForURL(/\/suppleance\/plan$/);
  await expect(sub.getByText('Entrée, prière du matin et O Canada').first()).toBeVisible();
  await expect(sub.getByText('Secrétariat : 555-0100')).toBeVisible();

  const since = await dbNow();
  await sub.getByRole('tab', { name: 'Élèves' }).click();
  await expect(sub.getByText(ALERT)).toHaveCount(0);
  await sub.getByRole('button', { name: 'Alertes de sécurité ou médicales' }).click();
  await expect(sub.getByText(ALERT)).toBeVisible();
  const [viewed] = await query<{ n: number }>(
    `select count(*)::int as n from public.audit_log
     where action = 'student_alert.viewed' and actor_type = 'substitute' and occurred_at >= $1
       and details ->> 'issued_by_role' = 'office'`,
    [since],
  );
  expect(viewed!.n).toBe(1);
  await sub.getByRole('button', { name: 'Masquer les alertes' }).click();
  await expectAccessible(sub);
});

test('5. The end-of-day report, and Isabelle reads it', async () => {
  await sub.getByRole('tab', { name: 'Fin de journée' }).click();
  await sub.getByRole('link', { name: 'Remplir le suivi de la journée' }).click();
  await sub.waitForURL(/\/suppleance\/report$/);
  const lesson = sub.getByTestId('report-lesson').first();
  await expect(async () => {
    await chipIn(lesson, 'Terminé').click();
    await expect(lesson.getByRole('radio', { name: 'Terminé' })).toBeChecked({ timeout: 1000 });
  }).toPass();
  await sub.getByLabel('Comportement et événements').fill(BEHAVIOUR);
  await sub.getByRole('button', { name: 'Envoyer le suivi' }).click();
  await sub.waitForURL(/\/suppleance\/done$/);
  await expect(sub.getByRole('heading', { name: 'Merci!' })).toBeVisible();

  // The office sees that it arrived, never what it says.
  await office.goto(`/absences?date=${DEMO_DAY}`);
  await expect(boardRow(office).getByTestId('board-report')).toHaveText('Suivi reçu');
  await expect(boardRow(office)).not.toContainText(BEHAVIOUR);

  // Isabelle: the banner on « Aujourd'hui », then the report with the notes decrypted.
  await teacher.goto('/today');
  const banner = teacher.getByTestId('report-banner');
  await expect(banner).toContainText('Le suivi de la suppléance du');
  await banner.getByRole('link', { name: 'Voir le suivi' }).click();
  await teacher.waitForURL(/\/plans\/[0-9a-f-]{36}\/report$/);
  await expect(teacher.getByRole('heading', { name: 'Suivi de la suppléance' })).toBeVisible();
  await expect(teacher.getByText(BEHAVIOUR)).toBeVisible();
  await expect(teacher.getByRole('button', { name: 'Confirmer le suivi' })).toBeVisible();
  await expectAccessible(teacher);
});

test('6. « Ressources » and « Texte différencié » (no name leaves the server)', async () => {
  test.setTimeout(120_000);
  await teacher.goto('/library');
  const field = teacher.getByRole('searchbox', { name: 'Rechercher une ressource' });
  await expect(async () => {
    await field.fill('nombres 1000');
    await expect(teacher).toHaveURL(/q=nombres\+1000/, { timeout: 2000 });
  }).toPass();
  await teacher.getByRole('link', { name: QUIZ.title }).first().click();
  await teacher.waitForURL(new RegExp(`/library/items/${QUIZ.id}`));
  await expect(teacher.getByRole('heading', { level: 1, name: QUIZ.title })).toBeVisible();

  await teacher.goto('/differentiate');
  await expect(teacher.getByRole('heading', { name: 'Texte différencié' })).toBeVisible();
  await teacher.getByLabel('Titre').fill(AI_TITLE);
  await teacher.getByLabel('Texte, consignes ou activité').fill(AI_TEXT);
  await teacher.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
  // The preview: Zoé becomes « Élève A » before anything is sent.
  await expect(teacher.locator('mark', { hasText: 'Élève A' })).toBeVisible();
  await teacher.getByRole('button', { name: 'Envoyer à l’IA' }).click();
  await teacher.waitForURL(/\/differentiate\/[0-9a-f-]{36}$/);
  await expect(teacher.getByRole('heading', { name: 'Débutant' })).toBeVisible({
    timeout: 60_000,
  });
  // Names come back only on our side.
  await expect(teacher.getByLabel('Texte', { exact: true }).last()).toHaveValue(
    /Zoé observe un castor/,
  );
  await teacher.getByText('Voir exactement ce qui a été envoyé').click();
  const sent = teacher.locator('details pre');
  await expect(sent).toContainText('Élève A observe un castor');
  await expect(sent).not.toContainText('Zoé');
});

test('7. « Présenter à la classe »: one question at a time, the answer when asked', async () => {
  await teacher.goto(`/library/items/${QUIZ.id}`);
  await teacher.getByRole('link', { name: 'Présenter à la classe' }).click();
  await teacher.waitForURL(new RegExp(`/projector/items/${QUIZ.id}`));
  const question = teacher.getByRole('heading', { level: 2, name: /^Question 1 sur \d+$/ });
  await expect(async () => {
    await teacher.keyboard.press('Home');
    await teacher.keyboard.press('ArrowRight');
    await expect(question).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(
    teacher.getByText('Quel nombre a 4 centaines, 0 dizaine et 7 unités?'),
  ).toBeVisible();
  await expect(teacher.getByText('Bonne réponse', { exact: true })).toHaveCount(0);
  await teacher.getByRole('button', { name: 'Afficher la réponse' }).click();
  await expect(teacher.getByRole('listitem').filter({ hasText: '407' })).toContainText(
    'Bonne réponse',
  );
  await expectAccessible(teacher);
});

test('8. « Tableau de bord de la direction »', async ({ browser }) => {
  sophie = await newContext(browser);
  principal = await sophie.newPage();
  await login(principal, DEMO.principal);
  await expect(principal).toHaveURL(/\/direction$/);
  await expect(
    principal.getByRole('heading', { level: 1, name: 'Tableau de bord de la direction' }),
  ).toBeVisible();
  // Isabelle's day: today's list, or « Prochain jour d'école » folded below it.
  const absence = principal.getByTestId('direction-absence').filter({ hasText: 'Mme Tremblay' });
  const nextDay = principal.locator('summary', { hasText: 'Prochain jour d’école' });
  if ((await nextDay.count()) > 0 && !(await absence.isVisible())) await nextDay.click();
  await expect(absence).toContainText('3e année – Mme Tremblay');
  // « Publié par Mme Tremblay le … à 6 h 21 » (released by her, early).
  await expect(absence).toContainText(/Publié (par .+ )?(le .+ )?à \d{1,2} h \d{2}/);
  await expect(absence).toContainText('Suivi reçu');
  await expect(
    principal.getByRole('heading', { name: 'Accès aux alertes (7 derniers jours)' }),
  ).toBeVisible();
  await expect(
    principal.getByRole('heading', { name: 'Contributions à la banque de ressources' }),
  ).toBeVisible();
  // Never the teachers' planning.
  await expect(principal.locator('a[href*="/planning"]')).toHaveCount(0);
  await expectAccessible(principal);
});

test('9. « Journal d’audit »: the code the office issued, and the CSV', async () => {
  await principal.goto('/audit');
  await principal.getByLabel('Catégorie').selectOption({ label: 'Alertes' });
  await principal.getByRole('button', { name: 'Afficher', exact: true }).click();
  await expect(principal).toHaveURL(/[?&]category=alerts(&|$)/);
  const entry = principal
    .getByRole('table')
    .getByRole('row')
    .filter({ hasText: 'Alertes de sécurité ou médicales consultées' })
    .first();
  await expect(entry).toContainText('Personne suppléante');
  // Who issued it, and the badge saying the office did (not the same fact twice).
  await expect(entry).toContainText('code émis par Julie Bergeron');
  await expect(entry).not.toContainText('(secrétariat)');
  await expect(entry).toContainText('Code émis par le secrétariat');
  await expectAccessible(principal);

  const since = await dbNow();
  const download = principal.waitForEvent('download');
  await principal.getByRole('link', { name: 'Télécharger (CSV)' }).click();
  const file = await readFile((await (await download).path())!, 'utf8');
  expect(file).toContain(';student_alert.viewed;');
  expect(file).toContain(';Code émis par le secrétariat');
  expect(file).not.toMatch(/(?<!\p{L})Samuel(?!\p{L})/u);
  expect(await auditCountBy('audit_log.exported', DEMO.principal, since)).toBe(1);
});

test('10. « Conseil »: the system’s state, an invitation, « Bienvenue » and the sample class', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await newContext(browser);
  const invitee = await newContext(browser);
  try {
    const page = await admin.newPage();
    await login(page, DEMO.boardAdmin);
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole('heading', { name: 'État du système' })).toBeVisible();
    for (const line of [
      'Service en arrière-plan',
      'Dernière sauvegarde',
      'Dernier nettoyage des données',
    ]) {
      await expect(page.getByText(new RegExp(`^${line}\\s:\\s`))).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Conservation des données' })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Sections de l’administration du conseil' })
      .getByRole('link', { name: 'Personnel', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await clickUntil(page.getByRole('button', { name: 'Inviter une personne' }), dialog);
    await dialog.getByLabel('Courriel', { exact: true }).fill(INVITEE.email);
    await dialog.getByLabel('Titre', { exact: true }).selectOption('Mme');
    await dialog.getByLabel('Nom complet').fill(INVITEE.name);
    await dialog.getByLabel('Rôle').selectOption({ label: 'Enseignant·e' });
    await dialog.getByRole('button', { name: 'Inviter', exact: true }).click();
    await page.waitForURL(/\/board\/staff\/invitations\/[0-9a-f-]{36}/);
    // The worker prepares the account; our servers send no invitation e-mail.
    await expect(
      page.getByRole('heading', {
        name: `Le compte est prêt. Envoyez ce message à ${INVITEE.name} :`,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('invite-message')).toContainText('code à 6 chiffres');
    await expect(page.getByRole('link', { name: 'Texto', exact: true })).toBeVisible();
    await expectAccessible(page);

    // The new teacher signs in: « Bienvenue » first, then « Pour bien commencer ».
    const newTeacher = await invitee.newPage();
    await login(newTeacher, INVITEE.email);
    await expect(newTeacher).toHaveURL(/\/bienvenue/);
    await expect(newTeacher.getByText(/^Les données sont conservées au Canada\./)).toBeVisible();
    await acceptWelcome(newTeacher, { honorific: 'Mme' });
    await newTeacher.goto('/demarrage');
    const checklist = newTeacher.getByTestId('onboarding-checklist');
    await expect(checklist).toContainText('0 sur 4');
    await newTeacher.getByRole('button', { name: 'Essayer avec une classe exemple (3e)' }).click();
    await expect(newTeacher.getByText('Classe exemple créée.')).toBeVisible();
    await newTeacher
      .getByRole('link', { name: 'Votre classe exemple : Classe exemple (3e année)' })
      .click();
    await expect(newTeacher.getByTestId('sample-notice')).toContainText(
      'Classe exemple : elle n’est jamais incluse dans un plan de suppléance',
    );
    await expectAccessible(newTeacher);
  } finally {
    await Promise.all([admin.close(), invitee.close()]);
  }
});
