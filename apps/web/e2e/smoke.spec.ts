import { expect, test } from '@playwright/test';
import { cleanupAbsences, closeDb, planIdOn } from './db';
import { DEMO, login, reportAbsence, schoolDay } from './helpers';

/**
 * Smoke test of an install (Phase 6, DECISIONS D-114), tagged @smoke: the docker-smoke CI job runs
 * it against the images behind Caddy (https://localhost, the self-hosted Supabase, the demo seed),
 * and it runs with the rest of the suite everywhere else. It proves what an image could get wrong:
 * the server is ready, the security headers are there, signing in works, a substitute plan's PDF
 * renders (its fonts were copied into the standalone build) and the substitute portal answers.
 */
test.describe('an install', { tag: '@smoke' }, () => {
  test.beforeAll(async () => {
    await cleanupAbsences(DEMO.teacher3);
  });

  test.afterAll(async () => {
    await cleanupAbsences(DEMO.teacher3);
    await closeDb();
  });

  test('is ready and sends its security headers', async ({ page, request }) => {
    const ready = await request.get('/api/health/ready');
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ok' });

    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
    const headers = response!.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('signs a teacher in and prints a substitute plan', async ({ page }) => {
    await login(page, DEMO.teacher3);
    const date = schoolDay({ weeksAhead: 5, isoWeekday: 2 });
    await reportAbsence(page, { startsOn: date });
    const absenceId = /\/absences\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
    const planId = await planIdOn(absenceId, date);

    const pdf = await page.request.get(`/absences/${absenceId}/plans/${planId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('serves the substitute portal', async ({ page }) => {
    const response = await page.goto('/suppleance');
    expect(response?.status()).toBe(200);
    expect(response!.headers()['content-security-policy']).toContain("default-src 'self'");
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
