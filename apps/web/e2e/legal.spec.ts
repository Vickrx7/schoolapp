import { CURRENT_TERMS_VERSION } from '@lynx/domain';
import { expect, test } from '@playwright/test';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Confidentialité et conditions » and « Nouveautés » (DECISIONS D-110, D-117): the notice and
 * the pilot terms are public, in French and English, and linked from the login page, the
 * substitute portal and the app's footer, which also shows the version.
 */

test('the privacy notice and the pilot terms are public, in French and English', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Confidentialité et conditions' }).click();
  await expect(page).toHaveURL(/\/confidentialite$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Confidentialité et conditions' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Avis de confidentialité' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conditions du projet pilote' })).toBeVisible();
  await expect(page.getByText(`Version des conditions : ${CURRENT_TERMS_VERSION}`)).toBeVisible();
  // Report card comments stay on the teacher's device (« Commentaires de bulletin », D-134).
  await expect(
    page.getByText(
      /Les commentaires de bulletin que vous rédigez restent dans le navigateur de votre appareil\s:\sils ne sont jamais envoyés à nos serveurs ni à l’intelligence artificielle\.$/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Les commentaires de bulletin sont effacés de votre appareil à la déconnexion, quand une autre personne se connecte sur ce navigateur, ou au plus tard 60 jours après la remise du bulletin\.$/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /^N’entrez aucun autre renseignement personnel sur un élève que son prénom, sauf dans les alertes, lorsque la direction les a activées, et dans les commentaires de bulletin, qui restent sur votre appareil\.$/,
    ),
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy and terms' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Terms of the pilot project' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
  await expectAccessible(page);
});

test('the substitute portal says every viewing is logged and links to the notice', async ({
  page,
}) => {
  await page.goto('/suppleance');
  await expect(page.getByTestId('portal-privacy-line')).toHaveText(
    'En utilisant ce code, vous accédez à des renseignements confidentiels réservés à cette journée ; chaque consultation est enregistrée.',
  );
  await page.getByRole('contentinfo').getByRole('link', { name: 'Confidentialité' }).click();
  await expect(page).toHaveURL(/\/confidentialite\?from=suppleance$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Confidentialité et conditions' }),
  ).toBeVisible();
  // Back to the portal, never to the staff sign-in.
  await page.getByRole('link', { name: 'Retour à l’accès suppléance' }).click();
  await expect(page).toHaveURL(/\/suppleance$/);
});

test('the app’s footer has « Confidentialité », « Nouveautés » and the version', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByTestId('app-version')).toHaveText(/^Version \S+$/);
  await footer.getByRole('link', { name: 'Nouveautés' }).click();
  await expect(page).toHaveURL(/\/nouveautes$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Nouveautés' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Version 0.8 · Commentaires de bulletin' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Version 0.6 · Prêt pour le projet pilote' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Version 0.1 · Aujourd’hui' })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('contentinfo').getByRole('link', { name: 'Confidentialité' }).click();
  await expect(page).toHaveURL(/\/confidentialite$/);
  await expect(page.getByRole('heading', { name: 'Conditions du projet pilote' })).toBeVisible();
});
