import { seedItemId } from '@lynx/content';
import { expect, test, type Page } from '@playwright/test';
import { closeDb, query, SEED } from './db';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * Web operations (Phase 6, DECISIONS D-111, D-112, D-119): the health checks monitors call, the
 * security headers every page family carries (and that nothing on those pages breaks under the
 * Content Security Policy: the suite runs on the production build), and the error reports the
 * app's own pages send.
 */

const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; " +
  "base-uri 'self'; form-action 'self'; object-src 'none'";

test.afterAll(async () => {
  await closeDb();
});

/** What the browser says when the policy blocks something. */
function watchPolicy(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (
      /Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(message.text())
    )
      violations.push(message.text());
  });
  return violations;
}

async function expectPolicy(page: Page, path: string): Promise<Record<string, string>> {
  const response = await page.goto(path);
  expect(response, path).not.toBeNull();
  const headers = response!.headers();
  expect(headers['content-security-policy'], path).toBe(CSP);
  expect(headers['x-robots-tag'], path).toBe('noindex, nofollow');
  expect(headers['x-content-type-options'], path).toBe('nosniff');
  expect(headers['x-powered-by'], path).toBeUndefined();
  return headers;
}

test('the health checks answer monitors and are never cached', async ({ request }) => {
  const live = await request.get('/api/health');
  expect(live.status()).toBe(200);
  expect(live.headers()['cache-control']).toBe('no-store');
  expect(await live.json()).toEqual({
    status: 'ok',
    release: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/),
  });

  const ready = await request.get('/api/health/ready');
  expect(ready.status()).toBe(200);
  expect(ready.headers()['cache-control']).toBe('no-store');
  // Never a detail: a monitor outside the server reads it.
  expect(await ready.json()).toEqual({ status: 'ok' });
});

test('every page family carries the security policy and works under it', async ({ page }) => {
  const violations = watchPolicy(page);
  // The public privacy page, then the login page.
  await expectPolicy(page, '/confidentialite');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expectPolicy(page, '/login');
  // Signing in needs the page's scripts: the policy lets the app's own run.
  await login(page, DEMO.teacher3, { stayOnPage: true });
  for (const path of [
    '/today',
    '/classes',
    '/library',
    '/calendar',
    '/absences',
    '/demarrage',
    '/commentaires',
    '/nouveautes',
    // « Mon année » (D-126): the grid's scroller and the planning dialogs.
    `/classes/${SEED.class3}/planning/year`,
  ]) {
    await expectPolicy(page, path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
  // The projector (« Présenter à la classe »): its player runs under the policy too.
  await expectPolicy(page, `/projector/items/${seedItemId('demo', 'pause-jeu-du-miroir')}`);
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  // The substitute portal and class devices keep their own rules on top.
  for (const path of ['/suppleance', '/jouer']) {
    const headers = await expectPolicy(page, path);
    expect(headers['cache-control'], path).toBe('no-store');
    expect(headers['referrer-policy'], path).toBe('no-referrer');
  }
  expect(violations).toEqual([]);
});

test('error reports are taken from the app’s own pages only, without any page text', async ({
  page,
  request,
}) => {
  const report = {
    name: 'TypeError',
    ref: 'k3x9a0bq',
    route: '/suppleance',
    messageHash: '0123456789abcdef',
  };
  const send = (body: unknown) =>
    page.evaluate(
      async (text) =>
        (
          await fetch('/api/client-error', {
            method: 'POST',
            body: text,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            keepalive: true,
            credentials: 'omit',
            cache: 'no-store',
          })
        ).status,
      JSON.stringify(body),
    );

  // From the substitute portal, whose pages send no referrer: the report still carries the
  // page's origin (lib/report-client-error.ts uses fetch, not a beacon).
  await page.goto('/suppleance');
  expect(await send(report)).toBe(204);
  // A message (page text) is refused, and so is a report from another site.
  expect(await send({ ...report, message: 'Samuel a oublié son lunch' })).toBe(400);
  const foreign = await request.post('/api/client-error', {
    headers: { Origin: 'https://example.com', 'Content-Type': 'text/plain' },
    data: JSON.stringify(report),
  });
  expect(foreign.status()).toBe(403);
  expect(foreign.headers()['cache-control']).toBe('no-store');
});

test('the error page and the page-not-found page are pages of their own', async ({ page }) => {
  // A page that does not exist: a heading, and the way back to the person's own home page.
  await login(page, DEMO.principal);
  await page.goto('/classes/00000000-0000-4000-8000-000000000000/students');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Cette page n’existe pas ou vous n’y avez pas accès.',
    }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Retour à l’accueil' }).click();
  await expect(page).toHaveURL(/\/direction$/);

  // The error page: a draft this form cannot read (stored by hand) makes the lesson form fail.
  const [teacher] = await query<{ id: string }>('select id from public.users where email = $1', [
    DEMO.teacher3,
  ]);
  const [unit] = await query<{ id: string }>(
    'select id from public.units where class_id = $1 order by created_at limit 1',
    [SEED.class3],
  );
  await page.context().clearCookies();
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ value: { title: 5 }, savedAt: Date.now() }));
  }, `lynx-draft:lesson:${teacher!.id}:${unit!.id}:new`);
  await login(page, DEMO.teacher3);
  await page.goto(`/classes/${SEED.class3}/planning/${unit!.id}`);
  const error = page.getByRole('heading', { level: 1, name: 'Oups, un problème est survenu.' });
  await expect(async () => {
    if (!(await error.isVisible())) {
      await page.getByRole('button', { name: 'Ajouter une leçon' }).first().click();
    }
    await expect(error).toBeVisible({ timeout: 1500 });
  }).toPass();
  await expect(page).toHaveTitle('Oups, un problème est survenu.');
  await expect(page.getByRole('button', { name: 'Signaler ce problème' })).toBeVisible();
  await expectAccessible(page);
});
