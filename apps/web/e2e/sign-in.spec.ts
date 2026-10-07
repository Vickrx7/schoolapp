import { expect, test } from '@playwright/test';
import { closeDb, createStaffUser, deleteStaff, query } from './db';
import { expectAccessible, latestCode } from './helpers';

/**
 * The staff sign-in throttle (DECISIONS D-121): five wrong codes lock the code, even against the
 * right one, until a new code is requested; the new code signs in. A throwaway account, deleted
 * at the end (it lands on « Bienvenue », having never accepted the pilot terms).
 */

test.afterAll(async () => {
  await closeDb();
});

/** The code checks recorded for an address (the throttle stores a keyed hash, never the address). */
async function checks(email: string): Promise<number> {
  const [row] = await query<{ n: number }>(
    `select count(*)::int as n from public.sign_in_attempts
     where kind = 'verify' and email_key = app.sign_in_key('email:' || $1)`,
    [email],
  );
  return row?.n ?? 0;
}

test('five wrong codes lock the code until a new one is requested', async ({ page }) => {
  test.setTimeout(90_000);
  const email = `e2e-throttle-${Date.now().toString(36)}@demo.lynx.test`;
  await createStaffUser({ email, name: 'Essai Verrou', role: 'teacher' });
  try {
    await page.goto('/login');
    const started = Date.now();
    await page.getByLabel('Adresse courriel', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    const codeField = page.getByLabel('Code à 6 chiffres', { exact: true });
    await expect(codeField).toBeVisible();
    const code = await latestCode(email, started);
    const wrong = code === '000000' ? '111111' : '000000';
    const signIn = page.getByRole('button', { name: 'Me connecter', exact: true });

    for (let i = 1; i <= 5; i++) {
      await codeField.fill(wrong);
      await signIn.click();
      await expect.poll(() => checks(email)).toBe(i);
      await expect(
        page.getByText('Ce code est incorrect ou expiré. Demandez-en un nouveau.'),
      ).toBeVisible();
    }

    // The right code is refused now, without reaching Auth.
    await codeField.fill(code);
    await signIn.click();
    const locked = page.getByText(
      'Trop de codes erronés. Demandez un nouveau code, ou ouvrez le lien reçu par courriel.',
    );
    await expect(locked).toBeVisible();
    expect(await checks(email)).toBe(5);
    await expectAccessible(page);

    // A new code (Auth sends one per address per second) signs in.
    await page.waitForTimeout(2500);
    const again = Date.now();
    await page.getByRole('button', { name: 'Renvoyer un code' }).click();
    const fresh = await latestCode(email, again + 1500);
    await codeField.fill(fresh);
    await signIn.click();
    await page.waitForURL(/\/bienvenue(?:[/?#]|$)/);
  } finally {
    await deleteStaff(email);
  }
});
