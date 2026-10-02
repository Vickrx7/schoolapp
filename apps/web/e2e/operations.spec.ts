import { expect, test, type Page } from '@playwright/test';
import { DEMO, login } from './helpers';

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
  await expectPolicy(page, '/login');
  // Signing in needs the page's scripts: the policy lets the app's own run.
  await login(page, DEMO.teacher3, { stayOnPage: true });
  for (const path of ['/today', '/classes', '/library', '/calendar', '/absences']) {
    await expectPolicy(page, path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
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
