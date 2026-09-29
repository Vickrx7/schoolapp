import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  auditCount,
  auditCountBy,
  cleanupAbsences,
  clearAttempts,
  closeDb,
  dbNow,
  deleteAlertsFor,
  insertPastPlan,
  lessonsWithProgress,
  nextLesson,
  openCodeWindow,
  planIdOn,
  query,
  resetLanguage,
  SEED,
} from './db';
import { DEMO, expectAccessible, login, reportAbsence, schoolDay } from './helpers';

// The substitute hand-off, office and substitute side (DECISIONS D-049 to D-051, D-053, D-054,
// D-056): the office board, codes, the direction's and office's view of a released plan, the plan
// PDF, the portal with its alerts, the end-of-day report, throttling, cutting access, and the
// teacher confirming the report. Three browsers: the teacher, the office (and direction), and the
// substitute, who has no account.
test.describe.configure({ mode: 'serial' });

const ALERT = 'Allergie aux noix, auto-injecteur dans le sac (test de suppléance)';
// « Gestion de classe » of the 3e année's Fiche (supabase/seed.sql): never shown to the office.
const CLASS_MANAGEMENT = 'Signal de silence';

let teacherContext: BrowserContext;
let officeContext: BrowserContext;
let subContext: BrowserContext | null = null;
let office: Page;
let sub: Page;
let wednesday: string;
let absenceId: string;
let planId: string;
let code: string;
/** The lessons the plan asks the substitute to teach first (from the seed's progress). */
let french: Awaited<ReturnType<typeof nextLesson>>;
let math: Awaited<ReturnType<typeof nextLesson>>;
const BEHAVIOUR = 'Journée calme; le groupe a bien travaillé en équipe (test de suppléance).';

async function newContext(browser: Browser): Promise<BrowserContext> {
  const use = test.info().project.use;
  return browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    timezoneId: use.timezoneId,
    viewport: use.viewport,
  });
}

/** Clicks a button, retrying until `then` shows (a tap before hydration is lost). */
async function clickUntil(
  button: ReturnType<Page['getByRole']>,
  then: ReturnType<Page['getByRole']>,
) {
  await expect(async () => {
    if (!(await then.isVisible())) await button.click();
    await expect(then).toBeVisible({ timeout: 1500 });
  }).toPass();
}

/**
 * Downloads the PDF behind a link with the page's cookies (the link is a plain <a>, never
 * prefetched) and checks that it is a PDF that is never cached.
 */
async function fetchPdf(
  page: Page,
  link: Locator,
  disposition: 'inline' | 'attachment' = 'inline',
) {
  const href = await link.getAttribute('href');
  expect(href).toMatch(disposition === 'inline' ? /\/pdf$/ : /\/pdf\?download=1$/);
  // Never the `download` attribute: a browser would save an error page as the file.
  await expect(link).not.toHaveAttribute('download');
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  expect(response.headers()['content-disposition']).toMatch(new RegExp(`^${disposition};`));
  expect(response.headers()['cache-control']).toMatch(/\bno-store\b/);
  expect((await response.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
}

/** The board's card for Isabelle's day. */
const boardRow = (page: Page) =>
  page.getByTestId('sub-day-row').filter({ hasText: 'Mme Tremblay' });

test.beforeAll(async ({ browser }) => {
  await cleanupAbsences(DEMO.teacher3);
  await clearAttempts();
  await deleteAlertsFor('Samuel', SEED.class3);
  // This spec reads the French screens; language.spec.ts changes the office's saved language.
  await resetLanguage(DEMO.office);

  // Isabelle records an alert for Samuel (encrypted by the web server), then reports an absence
  // three weeks ahead and releases its plan.
  teacherContext = await newContext(browser);
  const teacher = await teacherContext.newPage();
  await login(teacher, DEMO.teacher3);
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

  french = await nextLesson(SEED.class3, 'fra');
  math = await nextLesson(SEED.class3, 'mat');
  wednesday = schoolDay({ weeksAhead: 3, isoWeekday: 3 });
  await reportAbsence(teacher, { startsOn: wednesday });
  absenceId = /\/absences\/([0-9a-f-]{36})$/.exec(teacher.url())![1]!;
  planId = await planIdOn(absenceId, wednesday);
  await teacher.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect(teacher.getByTestId('plan-status').first()).toHaveText('Publié');

  officeContext = await newContext(browser);
  office = await officeContext.newPage();
  await login(office, DEMO.office);
});

test.afterAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await deleteAlertsFor('Samuel', SEED.class3);
  await clearAttempts();
  await Promise.all([teacherContext?.close(), officeContext?.close(), subContext?.close()]);
  await closeDb();
});

test('the office sees the day on « Suppléances » and generates a code', async () => {
  const since = await dbNow();
  await office.getByRole('link', { name: 'Suppléances' }).first().click();
  await office.waitForURL(/\/absences$/);
  await expect(office.getByRole('heading', { name: 'Suppléances du jour' })).toBeVisible();
  await office.goto(`/absences?date=${wednesday}`);
  const row = boardRow(office);
  await expect(row.getByTestId('board-status')).toContainText('Publié');
  await expect(row).toContainText('3e année – Mme Tremblay');
  await expect(row).toContainText('Aucun code actif');
  await expectAccessible(office);

  await clickUntil(
    row.getByRole('button', { name: 'Générer un code' }),
    office.getByTestId('sub-code'),
  );
  code = (await office.getByTestId('sub-code').textContent())!.trim();
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  const dialog = office.getByRole('dialog');
  // The messages open the office's own apps; the code link carries the code in the fragment.
  await expect(dialog.getByRole('link', { name: 'Texto' })).toHaveAttribute(
    'href',
    new RegExp(`^sms:.*${encodeURIComponent('#code=')}${code.replace('-', '')}`),
  );
  await expect(dialog.getByRole('link', { name: 'Courriel' })).toHaveAttribute(
    'href',
    /^mailto:\?subject=/,
  );
  await expect(dialog.getByRole('button', { name: 'Imprimer la feuille d’accueil' })).toBeVisible();
  await expectAccessible(office);
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(office.getByTestId('sub-code')).toHaveCount(0);
  await expect(row).toContainText('1 code actif');

  // « Imprimer le plan (PDF) »: rendered on request and audited; never alerts (D-053).
  await fetchPdf(office, row.getByRole('link', { name: 'Imprimer le plan (PDF)' }));
  expect(await auditCountBy('sub_plan.printed', DEMO.office, since)).toBe(1);

  // The released plan, read-only: first names, never « Gestion de classe » or alerts.
  await row.getByRole('link', { name: 'Voir le plan' }).click();
  await office.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
  await expect(office.getByTestId('plan-group').filter({ hasText: 'Samuel' })).toBeVisible();
  await expect(office.getByText(CLASS_MANAGEMENT)).toHaveCount(0);
  await expect(
    office.getByRole('button', { name: 'Alertes de sécurité ou médicales' }),
  ).toHaveCount(0);
  await expectAccessible(office);
  expect(await auditCountBy('sub_plan.viewed', DEMO.office, since)).toBe(1);
  expect(await auditCountBy('sub_code.issued', DEMO.office, since)).toBe(1);
  expect(await auditCountBy('student_alert.viewed', DEMO.office, since)).toBe(0);
});

test('the teacher prints her own plan without an audit entry', async () => {
  const teacher = await teacherContext.newPage();
  try {
    const since = await dbNow();
    await teacher.goto(`/absences/${absenceId}`);
    await fetchPdf(teacher, teacher.getByRole('link', { name: 'PDF du plan' }));
    await teacher.goto(`/absences/${absenceId}/plans/${planId}`);
    await fetchPdf(teacher, teacher.getByRole('link', { name: 'PDF du plan' }));
    expect(await auditCountBy('sub_plan.printed', DEMO.teacher3, since)).toBe(0);
  } finally {
    await teacher.close();
  }
});

test('the direction reads the released plan and its alerts', async ({ browser }) => {
  const context = await newContext(browser);
  try {
    const principal = await context.newPage();
    await login(principal, DEMO.principal);
    const since = await dbNow();
    await principal.goto(`/absences/${absenceId}/plans/${planId}`);
    await expect(principal.getByText(CLASS_MANAGEMENT)).toBeVisible();
    await clickUntil(
      principal.getByRole('button', { name: 'Alertes de sécurité ou médicales' }),
      principal.getByText(ALERT),
    );
    expect(await auditCountBy('student_alert.viewed', DEMO.principal, since)).toBe(1);
    expect(await auditCountBy('sub_plan.viewed', DEMO.principal, since)).toBe(1);
    await fetchPdf(principal, principal.getByRole('link', { name: 'Imprimer le plan (PDF)' }));
    expect(await auditCountBy('sub_plan.printed', DEMO.principal, since)).toBe(1);
  } finally {
    await context.close();
  }
});

test('the substitute signs in with the code and reads the day', async ({ browser }) => {
  await openCodeWindow(planId);
  subContext = await newContext(browser);
  sub = await subContext.newPage();
  // Without a session, the PDF address leads to « Accès suppléance ».
  const noSession = await sub.request.get('/suppleance/pdf', { maxRedirects: 0 });
  expect(noSession.status()).toBe(307);
  expect(noSession.headers()['location']).toMatch(/\/suppleance$/);
  // The short address on the welcome sheet leads to « Accès suppléance ».
  await sub.goto('/s');
  await sub.waitForURL(/\/suppleance$/);
  await expect(sub.getByRole('heading', { name: 'Accès suppléance' })).toBeVisible();
  await expectAccessible(sub);

  // Typed as read over the phone: lowercase, with a space.
  await sub.getByLabel('Code d’accès').fill(code.toLowerCase().replace('-', ' '));
  await sub.getByRole('button', { name: 'Commencer' }).click();
  await sub.waitForURL(/\/suppleance\/plan$/);
  await expect(sub.getByRole('tab', { name: 'Horaire' })).toHaveAttribute('aria-selected', 'true');
  await expect(sub.getByText('Entrée, prière du matin et O Canada').first()).toBeVisible();
  await expect(sub.getByText('Secrétariat : 555-0100')).toBeVisible();
  await expectAccessible(sub);

  // « Télécharger le PDF »: saved on the phone; every download is audited (D-053).
  const since = await dbNow();
  const download = sub.getByRole('link', { name: 'Télécharger le PDF' });
  await fetchPdf(sub, download, 'attachment');
  expect(await auditCount('sub_plan.printed', 'substitute', since)).toBe(1);

  // « Élèves »: groups with first names; alerts only on request, each reveal audited.
  await sub.getByRole('tab', { name: 'Élèves' }).click();
  await expect(sub.getByTestId('plan-group').filter({ hasText: 'Samuel' })).toBeVisible();
  await expect(sub.getByText(CLASS_MANAGEMENT)).toBeVisible();
  await expect(sub.getByText(ALERT)).toHaveCount(0);
  await sub.getByRole('button', { name: 'Alertes de sécurité ou médicales' }).click();
  await expect(sub.getByText(ALERT)).toBeVisible();
  expect(await auditCount('student_alert.viewed', 'substitute', since)).toBe(1);
  await sub.getByRole('button', { name: 'Masquer les alertes' }).click();
  await expect(sub.getByText(ALERT)).toHaveCount(0);
  // Put away (another app, the phone locked): gone when the page comes back.
  await sub.getByRole('button', { name: 'Alertes de sécurité ou médicales' }).click();
  await expect(sub.getByText(ALERT)).toBeVisible();
  await sub.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(sub.getByText(ALERT)).toHaveCount(0);
  expect(await auditCount('student_alert.viewed', 'substitute', since)).toBe(2);

  // The office sees the device.
  await office.goto(`/absences?date=${wednesday}`);
  await expect(boardRow(office)).toContainText('Appareil 1');

  // English chrome; the plan itself stays in the teacher's French.
  await sub.getByRole('button', { name: 'English' }).click();
  await expect(sub.getByRole('tab', { name: 'Schedule' })).toBeVisible();
  await expect(sub.getByText('Entrée, prière du matin et O Canada').first()).toBeAttached();
  await expect(sub.getByText('Office: 555-0100')).toBeVisible();
  await sub.getByRole('button', { name: 'Français' }).click();
  await expect(sub.getByRole('tab', { name: 'Horaire' })).toBeVisible();
});

/** A choice chip (a radio button or a checkbox drawn as a button) in a part of the page. */
const chipIn = (scope: ReturnType<Page['getByTestId']> | Page, name: string) =>
  scope.locator('label').filter({ hasText: new RegExp(`^${name}$`) });

test('the substitute fills in the end-of-day report and sends it', async () => {
  const since = await dbNow();
  await sub.getByRole('tab', { name: 'Fin de journée' }).click();
  await sub.getByRole('link', { name: 'Remplir le suivi de la journée' }).click();
  await sub.waitForURL(/\/suppleance\/report$/);
  await expect(sub.getByRole('heading', { name: 'Suivi de la journée' })).toBeVisible();

  const lesson = (title: string) => sub.getByTestId('report-lesson').filter({ hasText: title });
  // French « Terminé », Math « En partie », Liam absent, a behaviour note.
  await expect(async () => {
    await chipIn(lesson(french.title), 'Terminé').click();
    await expect(lesson(french.title).getByRole('radio', { name: 'Terminé' })).toBeChecked({
      timeout: 1000,
    });
  }).toPass();
  await chipIn(lesson(math.title), 'En partie').click();
  await chipIn(sub, 'Liam').click();
  await sub.getByLabel('Comportement et événements').fill(BEHAVIOUR);
  await expect(sub.getByTestId('report-save-state')).toContainText('Brouillon enregistré à', {
    timeout: 15_000,
  });
  await expectAccessible(sub);

  // The draft is on the server, with the free text encrypted.
  const [row] = await query<{ status: string; notes_ciphertext: string; content: unknown }>(
    'select status::text, notes_ciphertext, content from public.sub_reports where sub_plan_id = $1',
    [planId],
  );
  expect(row!.status).toBe('draft');
  expect(row!.notes_ciphertext).toMatch(/^v\d+\./);
  expect(row!.notes_ciphertext).not.toContain('calme');
  expect(JSON.stringify(row!.content)).not.toContain('calme');

  // Saved on the server: a reload shows it, without a « draft restored » notice.
  await sub.reload();
  await expect(lesson(french.title).getByRole('radio', { name: 'Terminé' })).toBeChecked();
  await expect(sub.getByText('Brouillon non enregistré récupéré')).toHaveCount(0);

  // Without this tab's copy, a reload brings the server's draft back.
  await sub.evaluate(() => window.sessionStorage.clear());
  await sub.reload();
  await expect(lesson(french.title).getByRole('radio', { name: 'Terminé' })).toBeChecked();
  await expect(lesson(math.title).getByRole('radio', { name: 'En partie' })).toBeChecked();
  await expect(sub.getByRole('checkbox', { name: 'Liam' })).toBeChecked();
  await expect(sub.getByLabel('Comportement et événements')).toHaveValue(BEHAVIOUR);

  // Before it is sent, the end of the day leads back to the report and asks before ending.
  await sub.goto('/suppleance/done');
  await expect(sub.getByTestId('report-status')).toHaveText(
    'Vous n’avez pas encore envoyé le suivi de la journée.',
  );
  const endDialog = sub.getByRole('dialog');
  await expect(async () => {
    if (!(await endDialog.isVisible())) {
      await sub.getByRole('button', { name: 'Terminer ma journée' }).click();
    }
    await expect(endDialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(endDialog).toContainText('Terminer sans envoyer le suivi?');
  await endDialog.getByRole('button', { name: 'Annuler' }).click();
  await sub.getByRole('link', { name: 'Remplir le suivi de la journée' }).click();
  await sub.waitForURL(/\/suppleance\/report$/);
  await expect(lesson(french.title).getByRole('radio', { name: 'Terminé' })).toBeChecked();

  await sub.getByRole('button', { name: 'Envoyer le suivi' }).click();
  await sub.waitForURL(/\/suppleance\/done$/);
  await expect(sub.getByRole('heading', { name: 'Merci!' })).toBeVisible();
  await expect(sub.getByTestId('report-status')).toHaveText(
    'Votre suivi a été envoyé à l’enseignant·e.',
  );
  await expectAccessible(sub);
  expect(await auditCount('sub_report.submitted', 'substitute', since)).toBe(1);

  // The office sees that it arrived, never what it says.
  await office.goto(`/absences?date=${wednesday}`);
  await expect(boardRow(office).getByTestId('board-report')).toHaveText('Suivi reçu');
  await expect(boardRow(office)).not.toContainText(BEHAVIOUR);
  await expect(boardRow(office).getByRole('link', { name: 'Voir le suivi' })).toHaveCount(0);
});

test('too many wrong codes make a device wait', async ({ browser }) => {
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await page.goto('/suppleance');
    const field = page.getByLabel('Code d’accès');
    const start = page.getByRole('button', { name: 'Commencer' });
    const message = page.locator('#sub-code-error');
    for (let i = 1; i <= 5; i++) {
      await field.fill(`ZZZZZ-ZZZ${i}Z`);
      await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().includes('/suppleance'),
        ),
        start.click(),
      ]);
      await expect(message).toHaveText(/^Ce code n’est pas valide\./);
    }
    await field.fill('ZZZZZ-ZZZ6Z');
    await start.click();
    await expect(message).toHaveText(/^Trop d’essais\. Réessayez dans \d+ secondes\.$/);
  } finally {
    await context.close();
    await clearAttempts();
  }
});

test('« Couper tout l’accès » ends the substitute’s access', async () => {
  await office.goto(`/absences?date=${wednesday}`);
  const row = boardRow(office);
  await row.getByRole('button', { name: 'Couper tout l’accès' }).click();
  await office.getByRole('dialog').getByRole('button', { name: 'Couper tout l’accès' }).click();
  await expect(row).toContainText('Aucun code actif');
  await expect(row).toContainText('accès coupé');

  await sub.reload();
  await sub.waitForURL(/\/suppleance\?ended=1$/);
  await expect(sub.getByRole('heading', { name: 'Accès suppléance' })).toBeVisible();
  await expect(sub.getByText('Votre accès a pris fin.')).toBeVisible();
  await expectAccessible(sub);
});

test('the teacher confirms the substitute’s report', async () => {
  const teacher = await teacherContext.newPage();
  try {
    // Planification: the reported lesson waits for the report, it is not checked off there.
    await teacher.goto(`/classes/${SEED.class3}/planning/${french.unitId}`);
    const pendingItem = teacher.getByRole('listitem').filter({ hasText: french.title }).first();
    await expect(pendingItem.getByTestId('pending-chip')).toBeVisible();
    await expect(pendingItem.getByRole('button', { name: 'Leçon donnée' })).toHaveCount(0);
    await expectAccessible(teacher);

    await teacher.goto('/today');
    const banner = teacher.getByTestId('report-banner');
    await expect(banner).toContainText('Le suivi de la suppléance du');
    await banner.getByRole('link', { name: 'Voir le suivi' }).click();
    await teacher.waitForURL(/\/plans\/[0-9a-f-]{36}\/report$/);
    await expect(teacher.getByRole('heading', { name: 'Suivi de la suppléance' })).toBeVisible();

    const lesson = (title: string) =>
      teacher.getByTestId('confirm-lesson').filter({ hasText: title });
    await expect(lesson(french.title)).toContainText('Selon la personne suppléante : Terminé');
    await expect(lesson(math.title)).toContainText('Selon la personne suppléante : En partie');
    // Absent students and the notes, decrypted for the teacher.
    await expect(teacher.getByTestId('report-absent')).toContainText('Liam');
    await expect(teacher.getByText(BEHAVIOUR)).toBeVisible();
    await expectAccessible(teacher);

    // Français « Confirmer », Math « Pas terminée », then « Confirmer le suivi ».
    await expect(async () => {
      await chipIn(lesson(french.title), 'Confirmer').click();
      await expect(lesson(french.title).getByRole('radio', { name: 'Confirmer' })).toBeChecked({
        timeout: 1000,
      });
    }).toPass();
    await chipIn(lesson(math.title), 'Pas terminée').click();
    await teacher.getByRole('button', { name: 'Confirmer le suivi' }).click();
    await expect(teacher.getByTestId('report-confirmed')).toContainText('Suivi confirmé le');

    // Planification: the Français lesson is done; Math's next lesson has not moved.
    await teacher.goto(`/classes/${SEED.class3}/planning/${french.unitId}`);
    await expect(
      teacher.getByRole('listitem').filter({ hasText: french.title }).first(),
    ).toContainText('Donnée le');
    expect((await nextLesson(SEED.class3, 'mat')).id).toBe(math.id);
    expect((await nextLesson(SEED.class3, 'fra')).id).not.toBe(french.id);

    // The banner is gone.
    await teacher.goto('/today');
    await expect(teacher.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible();
    await expect(teacher.getByTestId('report-banner')).toHaveCount(0);
  } finally {
    await teacher.close();
  }
});

test('the direction reads the report, read-only', async ({ browser }) => {
  const context = await newContext(browser);
  try {
    const principal = await context.newPage();
    await login(principal, DEMO.principal);
    const since = await dbNow();
    await principal.goto(`/absences?date=${wednesday}`);
    await boardRow(principal).getByRole('link', { name: 'Voir le suivi' }).click();
    await principal.waitForURL(/\/report$/);
    await expect(principal.getByText('Lecture seule')).toBeVisible();
    await expect(
      principal.getByTestId('confirm-lesson').filter({ hasText: french.title }),
    ).toContainText('Selon la personne suppléante : Terminé');
    await expect(principal.getByText(BEHAVIOUR)).toBeVisible();
    await expect(principal.getByRole('button', { name: 'Confirmer le suivi' })).toHaveCount(0);
    await expectAccessible(principal);
    expect(await auditCountBy('sub_report.viewed', DEMO.principal, since)).toBe(1);
  } finally {
    await context.close();
  }
});

test('with no report, the teacher marks the planned lessons as taught', async () => {
  // A day that is over and got no report (same lessons as the Wednesday plan).
  const past = await insertPastPlan(DEMO.teacher3, planId, 7);
  const before = await lessonsWithProgress(SEED.class3);
  const added = () =>
    query<{ lesson_id: string; taught_on: string; source: string }>(
      `select lesson_id, to_char(taught_on, 'YYYY-MM-DD') as taught_on, source::text
         from public.lesson_progress where class_id = $1 and not (lesson_id = any($2::uuid[]))`,
      [SEED.class3, before],
    );
  const teacher = await teacherContext.newPage();
  try {
    await teacher.goto(`/absences/${past.absenceId}/plans/${past.planId}/report`);
    await expect(teacher.getByRole('heading', { name: 'Aucun suivi reçu' })).toBeVisible();
    await expectAccessible(teacher);
    const mark = teacher.getByRole('button', { name: 'Marquer les leçons prévues comme données' });
    const dialog = teacher.getByRole('dialog');
    await expect(async () => {
      if (!(await dialog.isVisible())) await mark.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByRole('button', { name: 'Marquer les leçons prévues comme données' }).click();
    await expect(teacher.getByText(/leçons? marquées? comme données?\./)).toBeVisible();

    // Checked off as the teacher would, on the day of the absence; earlier records untouched.
    const rows = await added();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ taught_on: past.date, source: 'teacher' });
  } finally {
    await teacher.close();
    await query('delete from public.lesson_progress where lesson_id = any($1::uuid[])', [
      (await added()).map((r) => r.lesson_id),
    ]);
  }
});
