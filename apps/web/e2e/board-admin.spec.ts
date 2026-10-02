import { expect, test, type Page } from '@playwright/test';
import {
  closeDb,
  deleteEventsTitled,
  deleteStaff,
  query,
  restoreSchoolSettings,
  schoolSettings,
  SEED,
  cleanupAbsences,
} from './db';
import {
  reportPeriods,
  restoreReportPeriods,
  setReportPeriods,
  SEEDED_PERIODS,
} from './db-year-plan';
import {
  acceptWelcome,
  DEMO,
  e2ePrefix,
  expectAccessible,
  login,
  reportAbsence,
  schoolDay,
} from './helpers';

/**
 * « Conseil » (DECISIONS D-107, D-108, D-112): Nathalie Roy, the demo board's admin, invites a
 * teacher (the worker creates the account; the page gives the message to send), sees her sign in,
 * removes and restores her access (the worker bans and unbans the sign-in); then school years,
 * their report periods (« Mon année », D-124), resource reviewers, the office phone (substitute
 * plans show it), a board-wide PA day, AI usage and feedback. Needs the worker (AI_PROVIDER=fake) with SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. Everything it makes is removed at the end.
 */

test.afterAll(async () => {
  await closeDb();
});

/** Whether Auth has banned the account (the worker's `staff_auth_sync`). */
async function banned(email: string): Promise<boolean> {
  const [row] = await query<{ banned: boolean }>(
    'select coalesce(banned_until > now(), false) as banned from auth.users where email = $1',
    [email],
  );
  return row?.banned ?? false;
}

/** Confirms the open « ConfirmButton » dialog. */
async function confirm(page: Page, name: string) {
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

/** Signs a new teacher in, through « Bienvenue » once it exists (D-109). */
async function signInNewTeacher(page: Page, email: string) {
  await login(page, email);
  if (/\/bienvenue/.test(page.url())) await acceptWelcome(page);
  await expectToday(page);
}

/** Really in: « Aujourd'hui » rendered (not a redirect on its way to « pas d'accès »). */
async function expectToday(page: Page) {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aujourd’hui', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/today/);
}

test('a board admin invites a teacher, then removes and restores her access', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const email = `pilot-${Date.now().toString(36)}@demo.lynx.test`;
  const invitee = await browser.newContext();
  const inviteePage = await invitee.newPage();
  try {
    await login(page, DEMO.boardAdmin);
    await expect(page).toHaveURL(/\/board$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Administration du conseil' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Pour bien démarrer le conseil' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Année scolaire créée/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'État du système' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Conservation des données' })).toBeVisible();
    await expectAccessible(page);

    await page
      .getByRole('navigation', { name: 'Sections de l’administration du conseil' })
      .getByRole('link', { name: 'Personnel', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Personnel' })).toBeVisible();
    await expectAccessible(page);

    // The dialog offers this board's schools only (another board's school cannot be chosen),
    // and inviting oneself is refused.
    const dialog = page.getByRole('dialog');
    const open = page.getByRole('button', { name: 'Inviter une personne' });
    await expect(async () => {
      if (!(await dialog.isVisible())) await open.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(dialog.getByLabel('École', { exact: true }).locator('option')).toHaveText([
      'École élémentaire catholique Saint-Exemple',
    ]);
    await expectAccessible(page);
    await dialog.getByLabel('Courriel', { exact: true }).fill(DEMO.boardAdmin);
    await dialog.getByLabel('Nom complet').fill('Nathalie Roy');
    await dialog.getByRole('button', { name: 'Inviter', exact: true }).click();
    await expect(dialog.getByText('Vous ne pouvez pas modifier vos propres rôles.')).toBeVisible();

    // A new teacher: the worker prepares the account, then the page gives the message.
    await dialog.getByLabel('Courriel', { exact: true }).fill(email);
    await dialog.getByLabel('Titre', { exact: true }).selectOption('Mme');
    await dialog.getByLabel('Nom complet').fill('Isabelle Pilote');
    await dialog.getByLabel('Rôle').selectOption({ label: 'Enseignant·e' });
    await dialog.getByRole('button', { name: 'Inviter', exact: true }).click();
    await page.waitForURL(/\/board\/staff\/invitations\/[0-9a-f-]{36}\?lang=fr-CA/);
    await expect(
      page.getByRole('heading', {
        name: 'Le compte est prêt. Envoyez ce message à Isabelle Pilote :',
      }),
    ).toBeVisible({ timeout: 30_000 });
    const message = page.getByTestId('invite-message');
    await expect(message).toContainText('Bonjour Isabelle Pilote,');
    await expect(message).toContainText(
      '(Enseignant·e, École élémentaire catholique Saint-Exemple)',
    );
    await expect(message).toContainText('/login');
    await expect(message).toContainText(email);
    await expect(message).toContainText('code à 6 chiffres');
    await expect(page.getByRole('link', { name: 'Courriel', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`^mailto:${email.replace(/[.]/g, '\\.')}\\?subject=`),
    );
    await expect(page.getByRole('link', { name: 'Texto', exact: true })).toHaveAttribute(
      'href',
      /^sms:\?&body=/,
    );
    await expect(page.getByRole('button', { name: 'Copier le message' })).toBeVisible();
    // Axe on the settled page: right after a tap, a button's colour transition is still running
    // and axe would measure a blend of its two colours.
    await expectAccessible(page);
    // The English message, for an English-speaking colleague.
    const english = page.getByRole('button', { name: 'English', exact: true });
    await english.click();
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await expect(message).toContainText('Hello Isabelle Pilote,');

    // She signs in with the code; the board sees her as active.
    await signInNewTeacher(inviteePage, email);
    await page.goto('/board/staff');
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('Enseignant·e · É.É.C. Saint-Exemple');
    await expect(row).toContainText('Accès actif');

    // « Retirer l'accès »: the database refuses her at once, the worker bans the sign-in.
    await row.getByRole('link', { name: 'Isabelle Pilote' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Isabelle Pilote' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Retirer l’accès', exact: true }).click();
    await confirm(page, 'Retirer l’accès');
    await expect(page.getByText('Accès retiré.')).toBeVisible();
    await expect(page.getByText('Cette personne ne peut plus se connecter')).toBeVisible();
    await expect.poll(() => banned(email), { timeout: 30_000 }).toBe(true);
    await inviteePage.reload();
    await expect(inviteePage).toHaveURL(/\/(auth\/no-access|login)/);

    // « Rétablir l'accès »: she gets back in.
    await page.getByRole('button', { name: 'Rétablir l’accès', exact: true }).click();
    await confirm(page, 'Rétablir l’accès');
    await expect(page.getByText('Accès rétabli.')).toBeVisible();
    await expect.poll(() => banned(email), { timeout: 30_000 }).toBe(false);
    await inviteePage.goto('/today');
    if (/\/login/.test(inviteePage.url())) await signInNewTeacher(inviteePage, email);
    await expectToday(inviteePage);
  } finally {
    await invitee.close();
    await deleteStaff(email);
    await query('delete from public.staff_invitations where email = $1', [email]);
  }
});

test('a board admin keeps the school years, the reviewers and the feedback', async ({ page }) => {
  test.setTimeout(120_000);
  const year = `2099-${Date.now().toString(36).slice(-6)}`;
  const marc = DEMO.teacher5;
  const feedbackMessage = `Commentaire de test ${e2ePrefix()}`;
  try {
    await login(page, DEMO.boardAdmin);

    // « Années scolaires »: a far-future year, added, then deleted.
    await page.goto('/board/years');
    await expect(page.getByRole('heading', { level: 1, name: 'Années scolaires' })).toBeVisible();
    await expect(page.getByText('2026-2027')).toBeVisible();
    const dialog = page.getByRole('dialog');
    const add = page.getByRole('button', { name: 'Ajouter une année scolaire' });
    await expect(async () => {
      if (!(await dialog.isVisible())) await add.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByLabel('Nom').fill(year);
    await dialog.getByLabel('Premier jour').fill('2099-09-01');
    await dialog.getByLabel('Dernier jour').fill('2099-08-01');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(dialog.getByText('La fin doit être après le début.')).toBeVisible();
    await dialog.getByLabel('Dernier jour').fill('2100-06-25');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Année scolaire enregistrée.')).toBeVisible();
    await expect(page.getByText(year)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: `Supprimer l’année scolaire ${year}` }).click();
    await confirm(page, 'Supprimer');
    await expect(page.getByText('Année scolaire supprimée.')).toBeVisible();
    await expect(page.getByText(year)).toHaveCount(0);
    // The current year has classes: it cannot be deleted.
    await page.getByRole('button', { name: 'Supprimer l’année scolaire 2026-2027' }).click();
    await confirm(page, 'Supprimer');
    await expect(page.getByText('Impossible : cet élément est utilisé ailleurs.')).toBeVisible();
    await expect(page.getByText('2026-2027')).toBeVisible();

    // « Approbation des ressources »: Marc Gagnon designated, changed, then removed.
    await page.goto('/board/reviewers');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Approbation des ressources' }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Nathalie Roy' })).toBeVisible();
    await page.getByLabel('Personne', { exact: true }).selectOption({ label: 'Marc Gagnon' });
    await page.getByRole('button', { name: 'Désigner', exact: true }).click();
    await expect(page.getByText('Désignation enregistrée.')).toBeVisible();
    const marcRow = page.getByRole('group', { name: 'Marc Gagnon' });
    await expect(marcRow.getByRole('checkbox', { name: 'Approuve le contenu' })).toBeChecked();
    await marcRow.getByRole('checkbox', { name: 'Révise le contenu de foi' }).check();
    await expect(marcRow.getByRole('checkbox', { name: 'Révise le contenu de foi' })).toBeChecked();
    await expect
      .poll(async () => {
        const [r] = await query<{ faith: boolean }>(
          `select reviews_faith as faith from public.library_reviewers r
           join public.users u on u.id = r.user_id where u.email = $1`,
          [marc],
        );
        return r?.faith ?? null;
      })
      .toBe(true);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Retirer la désignation de Marc Gagnon' }).click();
    await confirm(page, 'Retirer la désignation');
    await expect(page.getByText('Désignation retirée.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Marc Gagnon' })).toHaveCount(0);

    // « Utilisation de l'IA »: per school, never per person, and the CSV.
    await page.goto('/board/usage');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Utilisation de l’IA' }),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: /École élémentaire catholique Saint-Exemple/ }),
    ).toBeVisible();
    await expectAccessible(page);
    const csvHref = await page
      .getByRole('link', { name: 'Télécharger (CSV)' })
      .getAttribute('href');
    const csv = await page.request.get(csvHref!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['cache-control']).toContain('no-store');
    const text = await csv.text();
    expect(text.startsWith('﻿Mois;École;Demandes;Échecs;Coût (USD)')).toBe(true);
    expect(text).toContain('École élémentaire catholique Saint-Exemple');
    await page.getByRole('link', { name: 'Mois précédent' }).click();
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);

    // « Commentaires reçus »: a teacher's feedback, read, then handled.
    await query(
      `insert into public.feedback (board_id, school_id, user_id, kind, message, route, device, locale)
       select $1, $2, u.id, 'idea', $3, '/today', 'phone', 'fr-CA' from public.users u where u.email = $4`,
      [SEED.board, SEED.school, feedbackMessage, DEMO.teacher3],
    );
    await page.goto('/board/feedback');
    await expect(page.getByRole('heading', { level: 1, name: 'Commentaires reçus' })).toBeVisible();
    const card = page.locator('li').filter({ hasText: feedbackMessage });
    await expect(card).toContainText('Idée');
    await expect(card).toContainText('Nouveau');
    await expect(card).toContainText('De Isabelle Tremblay (isabelle.tremblay@demo.lynx.test)');
    await expectAccessible(page);
    await card.getByRole('button', { name: 'Marquer comme lu' }).click();
    await expect(card.getByText('Lu', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Marquer comme traité' }).click();
    await expect(card.getByText('Traité', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Traité', exact: true }).click();
    await expect(page).toHaveURL(/status=done/);
    await expect(page.locator('li').filter({ hasText: feedbackMessage })).toBeVisible();
  } finally {
    await query(
      `delete from public.library_reviewers r using public.users u
       where r.user_id = u.id and u.email = $1`,
      [marc],
    );
    await query('delete from public.school_years where name = $1', [year]);
    await query('delete from public.feedback where message = $1', [feedbackMessage]);
  }
});

test('the office phone a board admin sets reaches substitute plans; a board PA day closes schools', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const original = await schoolSettings(SEED.school);
  const paDay = schoolDay({ weeksAhead: 6, isoWeekday: 3 });
  const absenceDay = schoolDay({ weeksAhead: 5, isoWeekday: 4 });
  const title = `Journée pédagogique ${e2ePrefix()}`;
  const teacher = await browser.newContext();
  const teacherPage = await teacher.newPage();
  try {
    await login(page, DEMO.boardAdmin);
    await page.goto('/board/schools');
    await expect(page.getByRole('heading', { level: 1, name: 'Écoles' })).toBeVisible();
    await expect(
      page.getByText('La personne qui gère le serveur ajoute les écoles du conseil.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Ajouter une école/ })).toHaveCount(0);
    await page.getByRole('link', { name: /École élémentaire catholique Saint-Exemple/ }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'École élémentaire catholique Saint-Exemple' }),
    ).toBeVisible();
    // The alerts switch is the direction's: a board admin only reads its state.
    await expect(
      page.getByText('Alertes de sécurité : activées — réservé à la direction de l’école'),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /alertes/i })).toHaveCount(0);
    await expect(page.getByText('Normalement décidé par la direction de l’école.')).toBeVisible();
    await expectAccessible(page);

    const phone = page.getByLabel('Téléphone du secrétariat');
    await expect(phone).toHaveValue('555-0100');
    await phone.fill('555-0100 poste 2');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(
      page.getByText('Numéro non valide : chiffres, espaces et + ( ) . - seulement.'),
    ).toBeVisible();
    await phone.fill('613 555-0199');
    await page.getByLabel('Fin des classes').fill('15:30');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Coordonnées enregistrées.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Téléphone du secrétariat')).toHaveValue('613 555-0199');
    // The direction's substitute settings are untouched.
    const after = await schoolSettings(SEED.school);
    expect(after.substitute).toEqual(original.substitute);

    // A board-wide PA day, from « Calendrier ».
    await page.goto('/calendar');
    const dialog = page.getByRole('dialog');
    const add = page.getByRole('button', { name: 'Ajouter un événement' });
    await expect(async () => {
      if (!(await dialog.isVisible())) await add.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(dialog.getByText('Pour : Tout le conseil · ')).toBeVisible();
    await expect(dialog.getByLabel('Type')).toHaveValue('pa_day');
    await dialog.getByLabel('Titre').fill(title);
    await dialog.getByLabel('Du', { exact: true }).fill(paDay);
    await dialog.getByLabel('Au', { exact: true }).fill(paDay);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Événement enregistré.')).toBeVisible();
    const event = page.locator('li').filter({ hasText: title });
    await expect(event).toContainText('Tout le conseil');
    await expect(event.getByRole('button', { name: /Supprimer/ })).toBeVisible();

    // Isabelle: no school that day, and her plan gives the new office number.
    await login(teacherPage, DEMO.teacher3);
    await teacherPage.goto(`/today?date=${paDay}`);
    await expect(teacherPage.getByText(`Pas de classe : ${title}.`)).toBeVisible();
    await cleanupAbsences(DEMO.teacher3);
    await reportAbsence(teacherPage, { startsOn: absenceDay });
    await teacherPage.getByRole('link', { name: 'Réviser le plan' }).first().click();
    await teacherPage.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
    await expect(teacherPage.getByTestId('plan-contacts')).toContainText('613 555-0199');
  } finally {
    await teacher.close();
    await cleanupAbsences(DEMO.teacher3);
    await deleteEventsTitled(title);
    await restoreSchoolSettings(SEED.school, original);
  }
});

test('a board admin sets a school year’s report periods from the usual dates', async ({ page }) => {
  test.setTimeout(120_000);
  // Only the progress report is set, with other dates: « Préremplir » replaces them all.
  await setReportPeriods([
    { ...SEEDED_PERIODS[0]!, ends_on: '2026-10-23', due_on: null, issued_on: null },
  ]);
  try {
    await login(page, DEMO.boardAdmin);
    // « Pour bien démarrer le conseil »: the periods are not all there yet.
    const item = page.getByRole('link', { name: /Périodes de bulletin/ });
    await expect(item).toContainText('À faire');

    await page.goto('/board/years');
    await expect(page.getByRole('heading', { level: 1, name: 'Années scolaires' })).toBeVisible();
    const card = page.getByRole('listitem').filter({ hasText: '2026-2027' });
    await expect(card.getByRole('term')).toHaveText(['Bulletin de progrès']);
    await expect(card.getByRole('definition')).toHaveText('Du 2 septembre 2026 au 23 octobre 2026');
    const dialog = page.getByRole('dialog', { name: 'Périodes de bulletin — 2026-2027' });
    const open = page.getByRole('button', { name: 'Périodes de bulletin de l’année 2026-2027' });
    await expect(async () => {
      if (!(await dialog.isVisible())) await open.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    const period = (name: string) => dialog.getByRole('group', { name, exact: true });
    const progress = period('Bulletin de progrès');
    const term1 = period('Bulletin scolaire — 1re étape');
    const term2 = period('Bulletin scolaire — 2e étape');
    await expect(progress.getByLabel('Fin de la période d’évaluation')).toHaveValue('2026-10-23');
    await expect(term1.getByLabel('Début de la période d’évaluation')).toHaveValue('');
    await expectAccessible(page);

    await dialog.getByRole('button', { name: 'Préremplir avec les dates habituelles' }).click();
    await expect(
      dialog.getByText(
        /^Dates habituelles proposées\s:\sà vérifier avec le calendrier du conseil\.$/,
      ),
    ).toBeVisible();
    await expect(progress.getByLabel('Fin de la période d’évaluation')).toHaveValue('2026-10-30');
    await expect(term1.getByLabel('Début de la période d’évaluation')).toHaveValue('2026-09-02');
    // Monday 15 February is « Jour de la Famille »: the remise moves to the Friday before.
    await expect(term1.getByLabel('Remise aux familles (facultatif)')).toHaveValue('2027-02-12');
    await expect(term2.getByLabel('Début de la période d’évaluation')).toHaveValue('2027-02-01');

    // Edits: a date before the window is refused; a period emptied is removed.
    await term1.getByLabel('Saisie au plus tard le (facultatif)').fill('2026-08-31');
    await term2
      .getByRole('button', { name: 'Effacer les dates : Bulletin scolaire — 2e étape' })
      .click();
    await expect(term2.getByLabel('Début de la période d’évaluation')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(term1.getByText('Cette date doit suivre le début de la période.')).toBeVisible();
    await term1.getByLabel('Saisie au plus tard le (facultatif)').fill('2027-02-04');
    await progress.getByLabel('Remise aux familles (facultatif)').fill('2026-11-12');
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Périodes de bulletin enregistrées.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(card.getByRole('term')).toHaveText([
      'Bulletin de progrès',
      'Bulletin scolaire — 1re étape',
    ]);
    await expect(card.getByRole('definition').first()).toHaveText(
      'Du 2 septembre 2026 au 30 octobre 2026 · saisie au plus tard le 6 novembre · remise le 12 novembre',
    );
    expect(await reportPeriods()).toEqual([
      {
        kind: 'progress',
        starts_on: '2026-09-02',
        ends_on: '2026-10-30',
        due_on: '2026-11-06',
        issued_on: '2026-11-12',
      },
      {
        kind: 'term1',
        starts_on: '2026-09-02',
        ends_on: '2027-01-29',
        due_on: '2027-02-04',
        issued_on: '2027-02-12',
      },
    ]);
    await expectAccessible(page);

    // With the second term back, the checklist item is done.
    await restoreReportPeriods();
    await page.goto('/board');
    await expect(page.getByRole('link', { name: /Périodes de bulletin/ })).toContainText('Fait');
  } finally {
    await restoreReportPeriods();
  }
});
