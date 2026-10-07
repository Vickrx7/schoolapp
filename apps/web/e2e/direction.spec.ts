import { expect, test } from '@playwright/test';
import { closeDb, deleteAbsence, insertReleasedAbsence, query, SEED } from './db';
import { addDaysIso, DEMO, expectAccessible, isSeededSchoolDay, login } from './helpers';

/**
 * « Tableau de bord de la direction » (Phase 6, DECISIONS D-102): the principal's landing page,
 * per school: the day's absences with their plan's status, the library contributions of the
 * school year, the month's AI totals and the latest alert entries. Never a teacher's planning.
 */

// A school-shared resource of the demo pack (supabase/seeds/20_library_demo.sql).
const SHARED_ITEM = {
  id: 'ba76a528-39d8-58a3-af85-02945aff7aaf',
  title: 'Banque de mots : les animaux de l’Ontario',
};

const absences: string[] = [];

test.afterAll(async () => {
  for (const id of absences) await deleteAbsence(id);
  await closeDb();
});

/** Today on the school's clock, or the next school day when there is no school today. */
function dashboardDay(): string {
  let day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  while (!isSeededSchoolDay(day)) day = addDaysIso(day, 1);
  return day;
}

test('the principal lands on her dashboard: absences, contributions, AI, alerts', async ({
  page,
}) => {
  const { absenceId } = await insertReleasedAbsence(DEMO.teacher3, dashboardDay(), SEED.class3);
  absences.push(absenceId);
  // Among the 10 latest contributions, whatever other specs shared before this one.
  await query('update public.library_items set updated_at = now() where id = $1', [SHARED_ITEM.id]);

  await login(page, DEMO.principal);
  await expect(page).toHaveURL(/\/direction$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tableau de bord de la direction' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'École élémentaire catholique Saint-Exemple' }),
  ).toBeVisible();

  // « Absences aujourd'hui »: Isabelle's day, its plan's status, codes, devices and report.
  await expect(page.getByRole('heading', { name: 'Absences aujourd’hui' })).toBeVisible();
  const absence = page.getByTestId('direction-absence').filter({ hasText: 'Mme Tremblay' });
  await expect(absence).toHaveCount(1);
  await expect(absence).toContainText('3e année – Mme Tremblay');
  await expect(absence).toContainText(/Publié (le .+ )?à \d{1,2} h \d{2}/);
  await expect(absence).toContainText('Aucun code actif');
  await expect(absence).toContainText('Aucun appareil');
  await expect(absence).toContainText('Pas encore de suivi');
  await expect(
    page.getByRole('link', { name: 'Ouvrir le tableau des suppléances' }),
  ).toHaveAttribute('href', '/absences');

  // « Contributions à la banque de ressources »: counts, then a school-shared resource credited
  // to its author as on its page.
  await expect(
    page.getByRole('heading', { name: 'Contributions à la banque de ressources' }),
  ).toBeVisible();
  await expect(page.getByTestId('contribution-counts')).toContainText(
    /\d+ ressources? partagées? avec l’école · \d+ avec tout le conseil · \d+ approuvées? par le conseil/,
  );
  const item = page.getByRole('link', { name: SHARED_ITEM.title });
  await expect(item).toHaveAttribute('href', `/library/items/${SHARED_ITEM.id}`);
  await expect(page.getByRole('listitem').filter({ has: item })).toContainText(
    'Banque de mots · Mme Tremblay',
  );

  await expect(page.getByRole('heading', { name: 'Utilisation de l’IA ce mois-ci' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Accès aux alertes (7 derniers jours)' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir le journal d’audit' })).toHaveAttribute(
    'href',
    `/audit?school=${SEED.school}&category=alerts`,
  );

  // Never the teachers' planning (D-013, D-102).
  await expect(page.locator('a[href*="/planning"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/classes"]')).toHaveCount(0);
  await expectAccessible(page);

  await page.goto(`/classes/${SEED.class3}/planning`);
  await expect(page.getByText('Cette page n’existe pas ou vous n’y avez pas accès.')).toBeVisible();
});
