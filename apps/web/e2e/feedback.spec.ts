import { expect, test, type Page } from '@playwright/test';
import { closeDb, query } from './db';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Commentaires » (DECISIONS D-111, D-116): a teacher writes from any page; a student's first
 * name is flagged and confirmed before anything is sent; the board's admin reads it on
 * « Commentaires reçus » and marks it « Traité ». An error page's reference travels with it.
 * Everything the test sends is deleted at the end.
 */

test.afterAll(async () => {
  await closeDb();
});

async function openFeedback(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Envoyer un commentaire' });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: 'Commentaires', exact: true }).click();
    }
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test('a teacher’s feedback names a student, is confirmed, and the board admin handles it', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const message = `Samuel n’arrive pas à ouvrir la leçon de lecture ${e2ePrefix()}`;
  const admin = await browser.newContext();
  try {
    await login(page, DEMO.teacher3);
    // From any page: « Classes » here (the button is in the top bar).
    await page.goto('/classes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Mes classes', exact: true }),
    ).toBeVisible();
    const dialog = await openFeedback(page);
    await expect(dialog.getByRole('radio', { name: 'Un problème' })).toBeChecked();
    await expectAccessible(page);

    await dialog.getByLabel('Votre message').fill(message);
    await expect(dialog.getByText(`${message.length} sur 2000 caractères`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();

    // The first name is flagged: nothing is sent until it is confirmed.
    await expect(
      dialog.getByText(/Ce message contient des prénoms d’élèves de votre école : Samuel\./),
    ).toBeVisible();
    const send = dialog.getByRole('button', { name: 'Envoyer', exact: true });
    await expect(send).toBeDisabled();
    expect(await query('select 1 from public.feedback where message = $1', [message])).toHaveLength(
      0,
    );
    await expectAccessible(page);
    await dialog.getByRole('checkbox', { name: 'Envoyer « Samuel » quand même' }).check();
    await send.click();
    await expect(page.getByText('Merci! Votre commentaire a été envoyé.')).toBeVisible();
    await expect(dialog).toBeHidden();

    const [row] = await query<Record<string, unknown>>(
      `select f.kind, f.route, f.device, f.locale, f.status, f.may_contact, f.error_ref,
              u.email, f.school_id is not null as has_school
       from public.feedback f join public.users u on u.id = f.user_id where f.message = $1`,
      [message],
    );
    expect(row).toEqual({
      kind: 'problem',
      route: '/classes',
      device: 'desktop',
      locale: 'fr-CA',
      status: 'new',
      may_contact: true,
      error_ref: null,
      email: DEMO.teacher3,
      has_school: true,
    });

    // The board's admin reads it and marks it « Traité ».
    const adminPage = await admin.newPage();
    await login(adminPage, DEMO.boardAdmin);
    await adminPage.goto('/board/feedback');
    const card = adminPage.locator('li').filter({ hasText: message });
    await expect(card).toContainText('Nouveau');
    await expect(card).toContainText('Isabelle Tremblay');
    await expect(card).toContainText('Page : /classes');
    await card.getByRole('button', { name: 'Marquer comme traité' }).click();
    await expect(card).toContainText('Traité');
    await expect
      .poll(async () => {
        const [r] = await query<{ status: string }>(
          'select status from public.feedback where message = $1',
          [message],
        );
        return r?.status;
      })
      .toBe('done');
  } finally {
    await admin.close();
    await query('delete from public.feedback where message = $1', [message]);
  }
});

test('an error’s reference goes with the report', async ({ page }) => {
  const message = `La page a affiché une erreur ${e2ePrefix()}`;
  try {
    await login(page, DEMO.teacher3);
    // Where the last-resort error page sends « Signaler ce problème ».
    await page.goto('/commentaires?ref=7f3a2c9d');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Envoyer un commentaire' }),
    ).toBeVisible();
    const reference = page.getByLabel('Référence de l’erreur (facultatif)');
    await expect(reference).toHaveValue('7f3a2c9d');
    await expectAccessible(page);
    await page.getByLabel('Votre message').fill(message);
    await page.getByRole('radio', { name: 'Une question' }).check();
    await page.getByRole('checkbox', { name: 'On peut me contacter à ce sujet' }).uncheck();
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(page.getByText('Merci! Votre commentaire a été envoyé.')).toBeVisible();
    const [row] = await query<{ kind: string; error_ref: string; may_contact: boolean }>(
      'select kind, error_ref, may_contact from public.feedback where message = $1',
      [message],
    );
    expect(row).toEqual({ kind: 'question', error_ref: '7f3a2c9d', may_contact: false });

    // Anything that is not a reference is left out.
    await page.goto('/commentaires?ref=pas%20une%20r%C3%A9f%C3%A9rence');
    await expect(page.getByLabel('Référence de l’erreur (facultatif)')).toHaveValue('');
  } finally {
    await query('delete from public.feedback where message = $1', [message]);
  }
});
