import { CURRENT_TERMS_VERSION } from '@lynx/domain';
import { expect, test, type Page } from '@playwright/test';
import { closeDb, createStaffUser, deleteSampleClasses, deleteStaff, query } from './db';
import { acceptWelcome, expectAccessible, login, nextSchoolMonday } from './helpers';

/**
 * A teacher's first days (DECISIONS D-109, D-110): « Bienvenue » (the pilot terms, then the
 * profile) before anything else, « Pour bien commencer », and a sample class to try the app with,
 * marked « Exemple » and never in a substitute plan; newer terms show a banner, never a block.
 * The accounts are made for the test and removed at the end.
 */

test.afterAll(async () => {
  await closeDb();
});

const newEmail = (tag: string) => `${tag}-${Date.now().toString(36)}@demo.lynx.test`;

/** « Pour bien commencer » with its count (« 0 sur 4 »). */
async function expectChecklist(page: Page, done: number) {
  const checklist = page.getByTestId('onboarding-checklist');
  await expect(checklist).toBeVisible();
  await expect(checklist).toContainText(`${done} sur 4`);
  return checklist;
}

test('a new teacher accepts the terms, then tries the app with a sample class', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = newEmail('onboarding');
  await createStaffUser({ email, name: 'Chantal Pilote', role: 'teacher' });
  try {
    // Every page waits for the terms, and comes back afterwards.
    await login(page, email);
    await expect(page).toHaveURL(/\/bienvenue\?next=%2Ftoday$/);
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/bienvenue\?next=%2Fcalendar$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Bienvenue' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'La protection des renseignements et le projet pilote' }),
    ).toBeVisible();
    // The two promises that matter at consent, with their limits (Phase 6 review, U1 and D1).
    await expect(
      page.getByText(
        'Les données sont conservées au Canada. Seul le texte envoyé à l’intelligence artificielle est traité aux États-Unis.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/^L’application remplace les noms des élèves et du personnel de vos écoles/),
    ).toContainText('retirez vous-même tout autre nom');
    // Report card comments stay on the device (« Commentaires de bulletin », D-134).
    await expect(
      page.getByText(
        /^Les commentaires de bulletin que vous rédigez restent dans le navigateur de votre appareil\s:\sils ne sont jamais envoyés à nos serveurs ni à l’intelligence artificielle\. Ils sont effacés à la déconnexion\.$/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Lire « Confidentialité et conditions »' }),
    ).toHaveAttribute('href', '/confidentialite');
    await expectAccessible(page);

    // « Commencer » without ticking the box: nothing is accepted.
    const start = page.getByRole('button', { name: 'Commencer', exact: true });
    await start.click();
    await expect(page.getByText('Cochez la case pour accepter les conditions.')).toBeVisible();
    await expect(page).toHaveURL(/\/bienvenue/);

    await acceptWelcome(page, { honorific: 'Mme' });
    await expect(page).toHaveURL(/\/calendar$/);
    const [profile] = await query<{ honorific: string; terms_version: string; accepted: boolean }>(
      `select honorific, terms_version, terms_accepted_at is not null as accepted
       from public.users where email = $1`,
      [email],
    );
    expect(profile).toEqual({
      honorific: 'Mme',
      terms_version: CURRENT_TERMS_VERSION,
      accepted: true,
    });
    const [audit] = await query<{ n: number }>(
      `select count(*)::int as n from public.audit_log a join public.users u on u.id = a.entity_id
       where u.email = $1 and a.action = 'user.terms_accepted'`,
      [email],
    );
    expect(audit!.n).toBe(1);

    // « Aujourd'hui »: the checklist, nothing done yet.
    await page.goto('/today');
    await expectChecklist(page, 0);
    await expect(page.getByRole('link', { name: 'Créer votre classe' })).toBeVisible();

    // The page of its own, and the sample class.
    await page.goto('/demarrage');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Pour bien commencer' }),
    ).toBeVisible();
    await expectChecklist(page, 0);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Essayer avec une classe exemple (3e)' }).click();
    await expect(page.getByText('Classe exemple créée.')).toBeVisible();
    const sampleLink = page.getByRole('link', {
      name: 'Votre classe exemple : Classe exemple (3e année)',
    });
    await expect(sampleLink).toBeVisible();
    // The sample class does not count toward the steps.
    await expectChecklist(page, 0);
    await expectAccessible(page);

    // Aujourd'hui on a school day: the sample class's lessons, marked « Exemple ».
    await page.goto(`/today?date=${nextSchoolMonday()}`);
    const lesson = page.getByRole('listitem').filter({ hasText: 'Lire et raconter une histoire' });
    await expect(lesson.first()).toBeVisible();
    await expect(lesson.first().getByTestId('sample-badge')).toHaveText('Exemple');
    await expect(page.getByText('Le problème de l’histoire').first()).toBeVisible();

    // The absence form says the sample class is left out of substitute plans.
    await page.goto('/absences/new');
    await expect(
      page.getByText('Votre classe exemple n’est pas incluse dans les plans de suppléance.'),
    ).toBeVisible();

    // The class list and the class page.
    await page.goto('/classes');
    const card = page.getByRole('link').filter({ hasText: 'Classe exemple (3e année)' });
    await expect(card.getByTestId('sample-badge')).toBeVisible();
    await expect(card).toContainText('20 élèves');
    await card.click();
    await expect(page).toHaveURL(/\/classes\/[0-9a-f-]{36}\/students$/);
    await expect(page.getByTestId('sample-notice')).toContainText(
      'Classe exemple : elle n’est jamais incluse dans un plan de suppléance et sera supprimée le',
    );
    await expect(page.getByRole('heading', { name: 'Élèves (20)' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Prénom ou surnom' }).first()).toHaveValue(
      'Anouk',
    );
    await expectAccessible(page);

    // « Mon année » (D-126): the sample units are dated from the lessons already taught, shown
    // on the year and saved only when the teacher confirms.
    const sampleClassId = /\/classes\/([0-9a-f-]{36})\//.exec(page.url())![1];
    await page.goto(`/classes/${sampleClassId}/planning/year`);
    const inferred = page.getByRole('region', {
      name: /^Dates d’après les leçons données \(\d+\)$/,
    });
    await expect(inferred).toBeVisible();
    await expect(
      page.getByRole('table').getByText('Dates d’après les leçons').first(),
    ).toBeVisible();
    await expectAccessible(page);
    const firstSave = inferred.getByRole('button', { name: /^Enregistrer ces dates\s:/ }).first();
    const saveName = (await firstSave.getAttribute('aria-label'))!;
    const save = page.getByRole('button', { name: saveName, exact: true });
    await expect(async () => {
      if (await save.isVisible()) await save.click();
      await expect(save).toHaveCount(0, { timeout: 2000 });
    }).toPass();
    await expect(page.getByText('Dates enregistrées.').first()).toBeVisible();

    // Deleting it: a simple confirmation, then the checklist, unchanged.
    const dialog = page.getByRole('dialog');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.getByRole('button', { name: 'Supprimer la classe exemple' }).click();
      }
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByRole('button', { name: 'Supprimer la classe exemple', exact: true }).click();
    await expect(page).toHaveURL(/\/demarrage$/);
    await expect(page.getByText('Classe exemple supprimée.')).toBeVisible();
    await expectChecklist(page, 0);
    await expect(
      page.getByRole('button', { name: 'Essayer avec une classe exemple (3e)' }),
    ).toBeVisible();

    // Never « Classe supprimée » in the direction's log (D-103): for the operator only.
    const rows = await query<{ action: string }>(
      `select a.action from public.audit_log a join public.users u on u.id = a.actor_user_id
       where u.email = $1 and a.entity_type = 'class' order by a.id`,
      [email],
    );
    expect(rows.map((r) => r.action)).toEqual(['sample_class.deleted']);

    // « Masquer » hides it on « Aujourd'hui »; « Profil » leads back to it, sample class and all.
    await page.goto('/today');
    await expectChecklist(page, 0);
    await page.getByRole('button', { name: 'Masquer', exact: true }).click();
    await expect(page.getByTestId('onboarding-checklist')).toBeHidden();
    await expect(page.getByText('Liste masquée. Vous la retrouverez dans Profil.')).toBeVisible();
    await page.goto('/profile');
    await page.getByRole('link', { name: 'Voir toutes les étapes' }).click();
    await expect(page).toHaveURL(/\/demarrage$/);
    await expect(
      page.getByText('La liste est masquée sur « Aujourd’hui ». Elle reste ici.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Essayer avec une classe exemple (3e)' }).click();
    await expect(page.getByText('Classe exemple créée.')).toBeVisible();
    // Why « Créer votre classe » is still to do, said once.
    const checklist = await expectChecklist(page, 0);
    await expect(checklist).toContainText(
      'Elle ne compte pas dans les étapes ci-dessus, n’est jamais incluse dans un plan de suppléance et sera supprimée le',
    );
    await page.goto('/today');
    await expect(page.getByTestId('sample-notice')).toContainText(
      'Classe exemple (3e année) · Elle n’est jamais incluse dans un plan de suppléance',
    );
  } finally {
    await deleteSampleClasses(email);
    await deleteStaff(email);
  }
});

test('newer terms show a banner and never block', async ({ page }) => {
  const email = newEmail('terms');
  await createStaffUser({ email, name: 'Rémi Pilote', role: 'teacher', honorific: 'M.' });
  try {
    await query(
      `update public.users set terms_version = '2026-09-pilote-0', terms_accepted_at = now()
       where email = $1`,
      [email],
    );
    await login(page, email);
    // Straight in: the app works, with a banner.
    await expect(page).toHaveURL(/\/today$/);
    const banner = page.getByTestId('terms-banner');
    await expect(banner).toContainText('Les conditions du projet pilote ont changé.');
    await page.goto('/classes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Mes classes', exact: true }),
    ).toBeVisible();
    await expectAccessible(page);

    await banner.getByRole('link', { name: 'Lire et accepter' }).click();
    await expect(page).toHaveURL(/\/bienvenue\?next=%2Fclasses$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Les conditions ont changé' }),
    ).toBeVisible();
    // What changed, in one line, and « Plus tard »: back to the page, the banner still there.
    await expect(page.getByTestId('terms-change')).toContainText('Ce qui a changé');
    // « Info-parents » (terms 2026-10-pilote-4, D-143).
    await expect(page.getByTestId('terms-change')).toContainText('les messages Info-parents');
    await expect(page.getByTestId('terms-change')).toContainText(
      'sans jamais l’envoyer, et il est effacé avec les prénoms des élèves.',
    );
    await page.getByRole('link', { name: 'Plus tard', exact: true }).click();
    await expect(page).toHaveURL(/\/classes$/);
    await expect(page.getByTestId('terms-banner')).toBeVisible();
    await page.getByTestId('terms-banner').getByRole('link', { name: 'Lire et accepter' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Les conditions ont changé' }),
    ).toBeVisible();
    // The terms alone: the profile was given at the first sign-in.
    await expect(page.getByRole('heading', { name: 'Votre profil' })).toBeHidden();
    await expectAccessible(page);
    const accept = page.getByRole('checkbox', {
      name: 'J’ai lu et j’accepte les conditions du projet pilote',
    });
    await expect(async () => {
      if (!(await accept.isChecked())) await accept.check();
      await expect(accept).toBeChecked({ timeout: 1000 });
    }).toPass();
    await page.getByRole('button', { name: 'Accepter les conditions', exact: true }).click();
    await expect(page).toHaveURL(/\/classes$/);
    await expect(page.getByTestId('terms-banner')).toBeHidden();
    const [row] = await query<{ terms_version: string; honorific: string }>(
      'select terms_version, honorific from public.users where email = $1',
      [email],
    );
    expect(row).toEqual({ terms_version: CURRENT_TERMS_VERSION, honorific: 'M.' });
  } finally {
    await deleteStaff(email);
  }
});
