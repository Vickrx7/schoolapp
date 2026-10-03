import { expect, test, type Page } from '@playwright/test';
import {
  auditCount,
  auditCountBy,
  clearAttempts,
  cleanupAbsences,
  closeDb,
  dbNow,
  nextLesson,
  openCodeWindow,
  query,
  SEED,
} from './db';
import { DEMO, expectAccessible, login, reportAbsence, schoolDay } from './helpers';

// « Consignes détaillées (IA) » on a substitute plan (3b, DECISIONS D-052). Needs the worker
// running with AI_PROVIDER=fake (as in CI): nothing leaves the machine.
test.describe.configure({ mode: 'serial' });

let aiWasOn: boolean | null = null;

async function removeRequests() {
  await query(
    `delete from public.ai_jobs j using public.users u
     where j.user_id = u.id and u.email = $1 and j.feature = 'sub_plan'`,
    [DEMO.teacher3],
  );
}

test.beforeAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await removeRequests();
  await clearAttempts();
  const [school] = await query<{ ai_enabled: boolean }>(
    'select ai_enabled from public.schools where id = $1',
    [SEED.school],
  );
  aiWasOn = school!.ai_enabled;
});

test.afterAll(async () => {
  await cleanupAbsences(DEMO.teacher3);
  await removeRequests();
  // The school's AI switch goes back to what it was before this spec.
  if (aiWasOn !== null) {
    await query('update public.schools set ai_enabled = $2 where id = $1', [SEED.school, aiWasOn]);
  }
  await closeDb();
});

/** The number of pages of a PDF. */
function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

/** The pages of the students' PDF at `href`, or 0 when there is nothing to print (404). */
async function studentPageCount(page: Page, href: string): Promise<number> {
  const response = await page.request.get(href);
  if (response.status() === 404) return 0;
  expect(response.headers()['content-type']).toBe('application/pdf');
  return pageCount(await response.body());
}

/** The principal turns AI on for the school (it may already be on after another spec). */
async function turnAiOn(page: Page) {
  await login(page, DEMO.principal);
  await page.goto('/school');
  const enable = page.getByRole('button', { name: 'Activer l’IA', exact: true });
  const isOn = page.getByText('L’IA est activée.');
  await expect(enable.or(isOn)).toBeVisible();
  if (await enable.isVisible()) {
    const dialog = page.getByRole('dialog');
    // A click before the page is interactive is lost: retry until the dialog opens.
    await expect(async () => {
      if (!(await dialog.isVisible())) await enable.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByRole('button', { name: 'Activer l’IA' }).click();
  }
  await expect(isOn).toBeVisible();
}

test('a teacher adds detailed instructions to her plan after checking what is sent', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  await turnAiOn(page);
  await context.clearCookies();

  const french = await nextLesson(SEED.class3, 'fra');
  await login(page, DEMO.teacher3);
  await reportAbsence(page, { startsOn: schoolDay({ weeksAhead: 3, isoWeekday: 3 }) });
  await page.getByRole('link', { name: 'Réviser le plan' }).first().click();
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
  // The students' pages of the library resources the plan uses (D-077), before any activity.
  const libraryPages = await studentPageCount(page, `${page.url()}/pdf?doc=activities`);

  // Nothing is sent before the preview: it shows groups as sizes, never the students.
  const panel = page.getByTestId('sub-plan-ai');
  const add = panel.getByRole('button', { name: 'Ajouter des consignes détaillées (IA)' });
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await add.click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass();
  await expect(dialog.getByRole('heading', { name: 'Vérifier avant d’envoyer' })).toBeVisible();
  const preview = dialog.getByTestId('sub-plan-ai-preview');
  await expect(preview).toContainText('G1 : Débutant, 3 élèves');
  await expect(preview).toContainText(french.title);
  for (const name of ['Samuel', 'Adam', 'Aïcha', 'Tremblay', 'Saint-Exemple']) {
    await expect(preview).not.toContainText(name);
  }
  const previewed = (await preview.innerText()).trim();
  await expectAccessible(page);

  await dialog.getByRole('button', { name: 'Envoyer à l’IA' }).click();
  await expect(dialog).toBeHidden();
  // The worker runs the request; the page shows the plan with it once it is back.
  await expect(panel.getByText('Consignes détaillées ajoutées')).toBeVisible({ timeout: 60_000 });
  const frenchBlock = page.getByTestId('plan-block').filter({ hasText: french.title }).first();
  await expect(frenchBlock).toContainText('Préparé avec l’IA');
  await expect(frenchBlock).toContainText('Dites :');
  await expect(frenchBlock.getByTestId('plan-ai-groups')).toContainText('G1 · Débutant');
  // The teacher's own note for the substitute is still there, as she wrote it.
  if (french.subNotes) await expect(frenchBlock).toContainText(french.subNotes.trim());

  // The students' activity sheets (periods without a unit get an activity): one page per group
  // for each activity, rendered on request and never cached.
  const sheets = page.getByTestId('activity-sheets-pdf');
  await expect(sheets).toHaveText('Activités pour les élèves (PDF)');
  const sheetsHref = (await sheets.getAttribute('href'))!;
  expect(sheetsHref).toMatch(/\/plans\/[0-9a-f-]{36}\/pdf\?doc=activities$/);
  const response = await page.request.get(sheetsHref);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  expect(response.headers()['cache-control']).toContain('no-store');
  const pdf = await response.body();
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const planUrl = page.url();
  const [, absenceId, planId] = /\/absences\/([0-9a-f-]{36})\/plans\/([0-9a-f-]{36})$/.exec(
    planUrl,
  )!;
  const [expected] = await query<{ groups: number; activities: number }>(
    `select jsonb_array_length(plan -> 'groups') as groups,
            (select count(*)::int from jsonb_array_elements(ai -> 'result' -> 'blocks') b
             where jsonb_typeof(b -> 'activity') = 'object') as activities
     from public.sub_plans where id = $1`,
    [planId],
  );
  expect(expected!.activities).toBeGreaterThan(0);
  const sheetCount = expected!.groups * expected!.activities + libraryPages;
  expect(pageCount(pdf)).toBe(sheetCount);

  // Once released, the direction prints them too: the same route, audited like the plan (D-053).
  await page.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect(page.getByTestId('plan-status').first()).toHaveText('Publié');
  const use = test.info().project.use;
  const contextOptions = { baseURL: use.baseURL, locale: use.locale, timezoneId: use.timezoneId };
  const principalContext = await browser.newContext(contextOptions);
  try {
    const principal = await principalContext.newPage();
    await login(principal, DEMO.principal);
    const since = await dbNow();
    await principal.goto(planUrl);
    const staffSheets = principal.getByTestId('activity-sheets-pdf');
    await expect(staffSheets).toHaveText('Activités pour les élèves (PDF)');
    const staffPdf = await principal.request.get((await staffSheets.getAttribute('href'))!);
    expect(staffPdf.headers()['content-type']).toBe('application/pdf');
    expect(await auditCountBy('sub_plan.printed', DEMO.principal, since)).toBe(1);
  } finally {
    await principalContext.close();
  }

  // The substitute reads the steps and downloads the sheets from her own plan page, recorded
  // like the plan's PDF. The teacher gives her a code from the absence page.
  await page.goto(`/absences/${absenceId}`);
  const generate = page.getByRole('button', { name: 'Code pour la personne suppléante' });
  const shownCode = page.getByTestId('sub-code');
  // A tap before the page is interactive is lost; one that went through disables the button
  // until the code shows, so a retry never makes a second code.
  await expect(async () => {
    if (!(await shownCode.isVisible()) && (await generate.isEnabled())) await generate.click();
    await expect(shownCode).toBeVisible({ timeout: 2000 });
  }).toPass();
  const code = (await shownCode.textContent())!.trim();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await expect(shownCode).toBeHidden();
  await openCodeWindow(planId!);

  const subContext = await browser.newContext(contextOptions);
  try {
    const sub = await subContext.newPage();
    await sub.goto('/suppleance');
    await sub.getByLabel('Code d’accès').fill(code);
    await sub.getByRole('button', { name: 'Commencer' }).click();
    await sub.waitForURL(/\/suppleance\/plan$/);
    await expect(
      sub.getByTestId('plan-block').filter({ hasText: french.title }).first(),
    ).toContainText('Dites :');
    const subSheets = sub.getByTestId('activity-sheets-pdf');
    await expect(subSheets).toHaveText('Télécharger les activités des élèves');
    const subSheetsHref = (await subSheets.getAttribute('href'))!;
    expect(subSheetsHref).toBe('/suppleance/pdf?doc=activities&download=1');
    const since = await dbNow();
    const subPdf = await sub.request.get(subSheetsHref);
    expect(subPdf.status()).toBe(200);
    expect(subPdf.headers()['content-type']).toBe('application/pdf');
    expect(subPdf.headers()['cache-control']).toContain('no-store');
    expect(pageCount(await subPdf.body())).toBe(sheetCount);
    expect(await auditCount('sub_plan.printed', 'substitute', since)).toBe(1);

    // « Voir exactement ce qui a été envoyé »: the text of the preview.
    await page.goto(planUrl);
    await expect(panel.getByText('Consignes détaillées ajoutées')).toBeVisible();
    await panel.getByText('Voir exactement ce qui a été envoyé').click();
    const sent = panel.locator('details pre');
    await expect(sent).toBeVisible();
    expect((await sent.innerText()).trim()).toBe(previewed);
    await expectAccessible(page);

    // She can remove it, even once the substitute has the plan: the plan goes back to her own
    // and the prepared steps.
    const remove = panel.getByRole('button', { name: 'Retirer les consignes détaillées' });
    await expect(async () => {
      if (!(await dialog.isVisible())) await remove.click();
      await expect(dialog).toBeVisible({ timeout: 2000 });
    }).toPass();
    await dialog.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(panel.getByText('Consignes détaillées ajoutées')).toBeHidden();
    await expect(frenchBlock).not.toContainText('Préparé avec l’IA');
    await expect(frenchBlock).not.toContainText('Dites :');
    if (libraryPages > 0) {
      // No activity any more: only the library resources' pages are left to print (D-077),
      // until she takes the resources out of the plan too (« Ne pas utiliser cette ressource »).
      await expect(sheets).toBeVisible();
      expect(await studentPageCount(page, sheetsHref)).toBe(libraryPages);
      const hide = page.getByRole('button', { name: 'Ne pas utiliser cette ressource' });
      // One resource per tap; a tap before the page is interactive is lost, so retry.
      await expect(async () => {
        if ((await hide.count()) > 0) await hide.first().click();
        await expect(hide).toHaveCount(0, { timeout: 1000 });
      }).toPass();
      await expect(page.getByTestId('plan-save-status')).toContainText('Enregistré à', {
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByTestId('plan-library-hidden').first()).toBeVisible();
    }
    // Nothing left to print. The substitute's address leads back to the plan.
    await expect(sheets).toBeHidden();
    expect((await page.request.get(sheetsHref)).status()).toBe(404);
    const gone = await sub.request.get(subSheetsHref, { maxRedirects: 0 });
    expect(gone.status()).toBe(307);
    expect(gone.headers()['location']).toMatch(/\/suppleance\/plan$/);
    await sub.reload();
    await expect(sub.getByTestId('plan-block').first()).toBeVisible();
    await expect(subSheets).toHaveCount(0);
  } finally {
    await subContext.close();
  }
});
