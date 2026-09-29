import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  auditCount,
  auditCountBy,
  cleanupAbsences,
  clearAttempts,
  closeDb,
  dbNow,
  deleteAlertsFor,
  openCodeWindow,
  planIdOn,
  SEED,
} from './db';
import { DEMO, expectAccessible, login, reportAbsence, schoolDay } from './helpers';

// The substitute hand-off, office and substitute side (DECISIONS D-049 to D-051, D-056): the
// office board, codes, the direction's and office's view of a released plan, the portal with
// its alerts and throttling, and cutting access. Three browsers: the teacher, the office (and
// direction), and the substitute, who has no account. The PDF and the end-of-day report come
// with their own rounds.
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

/** The board's card for Isabelle's day. */
const boardRow = (page: Page) =>
  page.getByTestId('sub-day-row').filter({ hasText: 'Mme Tremblay' });

test.beforeAll(async ({ browser }) => {
  await cleanupAbsences(DEMO.teacher3);
  await clearAttempts();
  await deleteAlertsFor('Samuel', SEED.class3);

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
  } finally {
    await context.close();
  }
});

test('the substitute signs in with the code and reads the day', async ({ browser }) => {
  await openCodeWindow(planId);
  subContext = await newContext(browser);
  sub = await subContext.newPage();
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

  // « Élèves »: groups with first names; alerts only on request, each reveal audited.
  const since = await dbNow();
  await sub.getByRole('tab', { name: 'Élèves' }).click();
  await expect(sub.getByTestId('plan-group').filter({ hasText: 'Samuel' })).toBeVisible();
  await expect(sub.getByText(CLASS_MANAGEMENT)).toBeVisible();
  await expect(sub.getByText(ALERT)).toHaveCount(0);
  await sub.getByRole('button', { name: 'Alertes de sécurité ou médicales' }).click();
  await expect(sub.getByText(ALERT)).toBeVisible();
  expect(await auditCount('student_alert.viewed', 'substitute', since)).toBe(1);
  await sub.getByRole('button', { name: 'Masquer les alertes' }).click();
  await expect(sub.getByText(ALERT)).toHaveCount(0);

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
      await expect(message).toHaveText('Ce code n’est pas valide.');
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
});
