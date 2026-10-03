import { addDays } from '@lynx/domain';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  SEED,
  clearProgress,
  closeDb,
  deleteEvent,
  insertSchoolEvent,
  nextLesson,
  query,
  setProgress,
} from './db';
import {
  deleteNewsletters,
  demoWeeks,
  newsletterOf,
  newsletterReminderDueToday,
  schoolAi,
} from './db-newsletters';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Info-parents » (DECISIONS D-136 to D-138), desktop, as Isabelle (3e année): the week's message
 * drafted from the class's own data (a lesson taught this week, an event next week with notes for
 * staff that never appear, a tip from the library's family guide with its English, an English
 * greeting), then edited (a student named, the typography fixed, the English written by hand, an
 * app line edited so its English is « à mettre à jour »), copied in both languages after « Des
 * élèves sont nommés », translated by the AI after « Vérifier avant d'envoyer » (D-139: names
 * replaced, a paragraph naming « Mme Dupuis » never sent, capitalized words to check, the box to
 * tick; the fake provider), printed (PDF, D-141) and marked sent. The app sends nothing to
 * families: the clipboard is the browser's and the PDF is opened by the teacher.
 * The messages, the event, the progress and the translation requests made here are deleted, and
 * the school's AI switch is put back.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = `${e2ePrefix('ip')} Spectacle de la chorale`;
const NOTES = 'Note au personnel : arriver à 8 h 30 au gymnase.';
let eventId: string | null = null;
let lessonId: string | null = null;
let weeks: Awaited<ReturnType<typeof demoWeeks>>;
let aiWasOn: boolean | null = null;

test.beforeAll(async () => {
  aiWasOn = await schoolAi(SEED.school);
  await deleteNewsletters(SEED.class3);
  weeks = await demoWeeks();
  // A 3e math lesson taught on this week's Monday, and an assembly next Tuesday.
  const lesson = await nextLesson(SEED.class3, 'mat');
  lessonId = lesson.id;
  await setProgress(lesson.id, weeks.thisWeek);
  eventId = await insertSchoolEvent({
    type: 'assembly',
    title: TITLE,
    date: addDays(weeks.nextWeek, 1),
    start: '13:15',
    end: '14:00',
    notes: NOTES,
  });
});

test.afterAll(async () => {
  if (aiWasOn !== null) await schoolAi(SEED.school, aiWasOn);
  await deleteNewsletters(SEED.class3);
  if (eventId) await deleteEvent(eventId);
  if (lessonId) await clearProgress([lessonId]);
  await closeDb();
});

const section = (page: Page, key: string) => page.getByTestId(`newsletter-section-${key}`);

/** The values of a section's French or English boxes. */
const values = (region: Locator, lang: 'fr' | 'en') =>
  region
    .locator(`textarea[lang="${lang}"]`)
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

/** A week's editor, once it is interactive (a tap before hydration is lost). */
async function openEditor(page: Page, week: string) {
  await page.goto(`/classes/${SEED.class3}/info-parents/${week}`);
  await expect(page.getByTestId('newsletter-editor')).toHaveAttribute('data-ready', 'true');
}

/** Every text box of the page, joined. */
const allText = (page: Page) =>
  page
    .locator('main textarea, main input')
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value).join('\n'));

test('« Préparer le message »: a first draft from the class’s week, in French and English', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, DEMO.teacher3);
  // A class without a message is never reminded about on « Aujourd'hui » (D-142).
  await page.goto('/today');
  await expect(
    page.getByRole('heading', { name: 'Aujourd’hui', level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('newsletter-reminder')).toHaveCount(0);
  await page.goto(`/classes/${SEED.class3}/students`);
  await page.getByRole('link', { name: 'Info-parents', exact: true }).click();
  await page.waitForURL(/\/info-parents$/);
  await expect(page.getByRole('heading', { name: 'Info-parents', level: 2 })).toBeVisible();
  await expect(page.getByText('Aucun message pour l’instant.')).toBeVisible();
  await expect(page.getByText(/L’application n’envoie rien aux familles\.$/)).toBeVisible();
  await expectAccessible(page);

  // This week first, then next week.
  await page
    .getByRole('link', { name: /^Préparer la semaine du / })
    .first()
    .click();
  await page.waitForURL(new RegExp(`/info-parents/${weeks.thisWeek}$`));
  await expect(
    page.getByRole('heading', { name: /^Préparer le message de la semaine du / }),
  ).toBeVisible();
  // Paul teaches blocks of the class: his subjects are left out unless asked.
  await expect(
    page.getByRole('checkbox', { name: 'Inclure les matières enseignées par mes collègues' }),
  ).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Inclure un moment de foi' })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Inclure des conseils des guides pour les familles' }),
  ).toBeChecked();
  await expect(
    page.getByText(/^Rien n’est envoyé\s:\svous relisez tout avant de le partager\.$/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Préparer le message' }).click();

  await expect(page.getByRole('heading', { name: /^Semaine du /, level: 2 })).toBeVisible();
  await expect(page.getByTestId('newsletter-notice')).toHaveText(
    /^Ce message ira à toutes les familles de la classe\. Ne nommez un élève que pour une nouvelle à partager avec tout le monde\s;\sjamais un comportement, la santé ou une évaluation\.$/,
  );
  // The header is shown, never stored.
  await expect(page.getByTestId('newsletter-header')).toHaveText(
    /^École élémentaire catholique Saint-Exemple · 3e année – Mme Tremblay · Semaine du /,
  );
  await expect(page.getByLabel('Signature')).toHaveValue('Mme Tremblay');

  // The greeting in both languages.
  expect(await values(section(page, 'message'), 'fr')).toEqual(['Bonjour chères familles,']);
  expect(await values(section(page, 'message'), 'en')).toEqual(['Dear families,']);
  // This week's math lesson, under its unit.
  const thisWeek = await values(section(page, 'thisWeek'), 'fr');
  expect(thisWeek).toContainEqual(
    expect.stringMatching(/^Mathématiques \(unité «\sLes nombres jusqu’à 1 000\s»\)\s:\s«\s/),
  );
  expect(await values(section(page, 'thisWeek'), 'en')).toContainEqual(
    expect.stringMatching(/^Mathematics \(unit “Les nombres jusqu’à 1 000”\): “/),
  );
  // Next week's assembly with its time; never its notes for staff.
  expect(await values(section(page, 'dates'), 'fr')).toContainEqual(
    expect.stringMatching(new RegExp(`^Mardi \\d+(?:er)? \\S+ à 13 h 15\\s:\\s${TITLE}$`)),
  );
  expect(await values(section(page, 'dates'), 'en')).toContainEqual(
    expect.stringMatching(
      new RegExp(`^Tuesday, \\S+ \\d+ at 1:15 p\\.m\\.: Assembly, “${TITLE}”$`),
    ),
  );
  expect(await allText(page)).not.toContain('arriver à 8 h 30');
  // A tip from « Les nombres jusqu’à 1 000 à la maison », with its English tip.
  expect(await values(section(page, 'atHome'), 'fr')).toContain(
    'Chercher des nombres autour de vous (adresses, prix, pages d’un livre) et demander à votre enfant de les lire à voix haute.',
  );
  expect(await values(section(page, 'atHome'), 'en')).toContain(
    'Look for numbers around you (addresses, prices, page numbers) and ask your child to read them aloud.',
  );
  // The app’s English, for each of its lines.
  await expect(section(page, 'thisWeek').getByTestId('english-status').first()).toHaveText(
    /^English\s:\spréparé par l’application$/,
  );
  await expect(page.getByTestId('newsletter-save-bar')).toContainText('Enregistré');
  await expectAccessible(page);

  const stored = await newsletterOf(SEED.class3, weeks.thisWeek);
  expect(stored?.status).toBe('draft');
  const json = JSON.stringify(stored?.content);
  expect(json).not.toContain('Saint-Exemple');
  expect(json).not.toContain('arriver à 8 h 30');
});

test('editing: a student named, the typography, the English by hand; copied after the check', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page, DEMO.teacher3);
  await openEditor(page, weeks.thisWeek);
  const message = section(page, 'message');
  await message.getByRole('button', { name: 'Ajouter un paragraphe' }).click();
  const typed = message.getByTestId('newsletter-item').nth(1);
  await expect(typed.getByLabel('Français')).toBeFocused();
  await typed.getByLabel('Français').fill('Bravo à Samuel ! Son exposé sur le castor était super.');
  await expect(typed.getByTestId('english-status')).toHaveText(/^English\s:\sà écrire$/);
  await expect(page.getByTestId('newsletter-save-bar')).toContainText(
    'Modifications non enregistrées',
  );
  // Nothing is copied, printed or marked sent before a save.
  await expect(page.getByRole('button', { name: 'Copier les deux' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Imprimer les deux (PDF)' })).toBeDisabled();
  await expect(page.getByText('Enregistrez vos modifications d’abord.')).toBeVisible();

  // « Corriger la typographie »: no space before « ! » in the catalogue's Canadian usage.
  await page.getByRole('button', { name: 'Corriger la typographie' }).click();
  await expect(typed.getByLabel('Français')).toHaveValue(
    'Bravo à Samuel! Son exposé sur le castor était super.',
  );
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId('newsletter-save-bar')).toContainText('Enregistré');

  // « Copier les deux »: the check names Samuel and the paragraph without English.
  await page.getByRole('button', { name: 'Copier les deux' }).click();
  const check = page.getByRole('dialog', { name: 'Des élèves sont nommés' });
  await expect(
    check.getByText('Ce message nomme Samuel. Il ira à toutes les familles de la classe.'),
  ).toBeVisible();
  await expect(
    check.getByText(
      /^1 paragraphe n’a pas de version anglaise à jour\s:\sil paraîtra en français\.$/,
    ),
  ).toBeVisible();
  await expectAccessible(page);
  await check.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText(/^Message copié\./)).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(
    /^École élémentaire catholique Saint-Exemple · 3e année – Mme Tremblay · Semaine du /,
  );
  expect(copied).toContain('Bonjour chères familles,\n\nBravo à Samuel!');
  expect(copied).toContain('\n\n* * *\n\n');
  expect(copied).toContain('Dear families,\n\nBravo à Samuel!');
  expect(copied).toMatch(/\nCette semaine en classe\n• /);
  expect(copied).toMatch(/\n• Mathématiques \(unité «\sLes nombres jusqu’à 1 000\s»\)\s:\s/);
  expect(copied).toMatch(/\nThis week in class\n• /);
  expect(copied).toContain('\n• Mathematics (unit “Les nombres jusqu’à 1 000”): ');
  expect(copied).toContain('Mme Tremblay');
  expect(copied).not.toContain('arriver à 8 h 30');

  // Her English for her paragraph; an app line edited: its English is to update.
  await typed.getByLabel('English').fill('Well done, Samuel! His talk on beavers was great.');
  await expect(typed.getByTestId('english-status')).toHaveText(/^English\s:\sécrit par vous$/);
  const line = section(page, 'thisWeek').getByTestId('newsletter-item').first();
  const french = line.getByLabel('Français');
  await french.fill(`${await french.inputValue()} Bravo à toute la classe!`);
  await expect(line.getByTestId('english-status')).toHaveText(
    /^English\s:\sà mettre à jour \(le français a changé\)$/,
  );
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId('newsletter-save-bar')).toContainText('Enregistré');
  await expectAccessible(page);

  // Saved: the page shows the same after a reload.
  await openEditor(page, weeks.thisWeek);
  await expect(
    section(page, 'thisWeek').getByTestId('newsletter-item').first().getByTestId('english-status'),
  ).toHaveText(/^English\s:\sà mettre à jour/);
  await expect(page.getByText('Brouillon non enregistré récupéré.')).toHaveCount(0);
});

test('« Traduire en anglais (IA) »: exactly what is sent, an unknown name never, then the English', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Off wherever the school's AI is off.
  await schoolAi(SEED.school, false);
  await login(page, DEMO.teacher3);
  await openEditor(page, weeks.thisWeek);
  await expect(page.getByRole('button', { name: 'Corriger la typographie' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Traduire en anglais (IA)' })).toHaveCount(0);

  await schoolAi(SEED.school, true);
  await openEditor(page, weeks.thisWeek);
  // A thank-you to a parent the app does not know, and news with a student and a place.
  const reminders = section(page, 'reminders');
  await reminders.getByRole('button', { name: 'Ajouter un paragraphe' }).click();
  await reminders
    .getByTestId('newsletter-item')
    .last()
    .getByLabel('Français')
    .fill('Merci à Mme Dupuis, qui a accompagné notre sortie.');
  const message = section(page, 'message');
  await message.getByRole('button', { name: 'Ajouter un paragraphe' }).click();
  const news = message.getByTestId('newsletter-item').last();
  await news.getByLabel('Français').fill('Samuel a lu son poème au parc Montfort.');
  // Not before a save.
  await expect(page.getByRole('button', { name: 'Traduire en anglais (IA)' })).toBeDisabled();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId('newsletter-save-bar')).toContainText('Enregistré');

  await page.getByRole('button', { name: 'Traduire en anglais (IA)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vérifier avant d’envoyer' });
  const preview = dialog.getByTestId('translate-preview');
  await expect(
    dialog.getByText(
      'Voici exactement ce qui sera envoyé à l’intelligence artificielle pour la traduction. Les noms que l’application connaît sont remplacés (surlignés).',
    ),
  ).toBeVisible();
  // The edited app line, the news and the thank-you have no up-to-date English.
  await expect(
    dialog.getByRole('radio', {
      name: 'Seulement les paragraphes sans traduction à jour (3)',
    }),
  ).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^Tout retraduire \(\d+\)$/ })).toBeVisible();
  await expect(preview.getByTestId('translate-count')).toHaveText(
    '2 paragraphes seront envoyés. 1 nom remplacé.',
  );
  // Exactly what is sent: Samuel is a marker, highlighted; « Mme Dupuis » is not there at all.
  const sent = dialog.getByTestId('translate-sent');
  await expect(sent.locator('mark')).toHaveText(['Élève A']);
  await expect(sent).toContainText('Élève A a lu son poème au parc Montfort.');
  await expect(sent).toContainText('Section : Cette semaine en classe');
  await expect(sent).not.toContainText('Samuel');
  await expect(sent).not.toContainText('Dupuis');
  await expect(sent).not.toContainText('Saint-Exemple');
  const notSent = dialog.getByTestId('translate-not-sent');
  await expect(notSent).toContainText('Non envoyé — traduisez-le vous-même');
  await expect(notSent).toContainText('Merci à Mme Dupuis, qui a accompagné notre sortie.');
  await expect(notSent).toContainText(
    'contient un nom que l’application ne connaît pas après un titre (Mme Dupuis)',
  );
  await expect(dialog.getByTestId('translate-words')).toContainText(
    /^Mots avec majuscule à vérifier\s:\s.*Montfort/,
  );
  // Nothing goes before « J’ai vérifié ».
  const send = dialog.getByRole('button', { name: 'Envoyer à l’IA' });
  await expect(send).toBeDisabled();
  await expectAccessible(page);
  await dialog
    .getByRole('checkbox', {
      name: 'J’ai vérifié : le texte ne nomme aucune autre personne que l’application ne connaît pas.',
    })
    .check();
  await send.click();
  await expect(dialog).toBeHidden();

  // The worker (fake provider) translates; then the English is there, Samuel put back.
  await expect(news.getByLabel('English')).toHaveValue(/^Demo translation: Samuel\.$/, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('newsletter-editor')).toHaveAttribute('data-ready', 'true');
  await expect(news.getByTestId('english-status')).toHaveText(
    /^English\s:\straduit par l’IA — à relire$/,
  );
  await expect(page.getByTestId('translate-done')).toContainText(
    /^L’IA a traduit 2 paragraphes\s:\srelisez leur anglais/,
  );
  const thanks = section(page, 'reminders').getByTestId('newsletter-item').last();
  await expect(thanks.getByLabel('English')).toHaveValue('');
  await expect(thanks.getByTestId('english-status')).toHaveText(/^English\s:\sà écrire$/);
  const line = section(page, 'thisWeek').getByTestId('newsletter-item').first();
  await expect(line.getByTestId('english-status')).toHaveText(
    /^English\s:\straduit par l’IA — à relire$/,
  );
  await expectAccessible(page);
  // What left, as the worker recorded it: the markers, never the unknown name or the student.
  const stored = await newsletterOf(SEED.class3, weeks.thisWeek);
  const [job] = await query<{ sent_text: string }>(
    `select sent_text from public.ai_jobs
     where feature = 'newsletter_translate' and input ->> 'newsletterId' = $1`,
    [stored!.id],
  );
  expect(job!.sent_text).toContain('<P1>\nÉlève A a lu son poème au parc Montfort.\n</P1>');
  expect(job!.sent_text).not.toMatch(/Dupuis|Samuel|Tremblay|Saint-Exemple/);
});

test('« Imprimer (PDF) »: the saved message, after the check, rendered on demand, never cached', async ({
  page,
}) => {
  await login(page, DEMO.teacher3);
  await openEditor(page, weeks.thisWeek);
  const base = `/classes/${SEED.class3}/info-parents/${weeks.thisWeek}/pdf`;
  const slug = '3e-annee-mme-tremblay';
  const pages = (body: Buffer) => body.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  const counts = new Map<string, number>();
  for (const [query, file] of [
    ['', `info-parents-${slug}-${weeks.thisWeek}.pdf`],
    ['?lang=both', `info-parents-${slug}-${weeks.thisWeek}.pdf`],
    ['?lang=fr', `info-parents-${slug}-${weeks.thisWeek}-fr.pdf`],
    ['?lang=en&download=1', `family-newsletter-${slug}-${weeks.thisWeek}.pdf`],
  ] as const) {
    const response = await page.request.get(`${base}${query}`);
    expect(response.status(), query).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toBe('application/pdf');
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    // A PDF route carries no page security policy (it would stop the browser's viewer).
    expect(headers['content-security-policy']).toBeUndefined();
    expect(headers['content-disposition']).toBe(
      `${query.includes('download=1') ? 'attachment' : 'inline'}; filename="${file}"`,
    );
    const body = await response.body();
    expect(body.subarray(0, 5).toString('latin1'), query).toBe('%PDF-');
    counts.set(query, pages(body));
  }
  // Each language on pages of its own, French first: one each when the week's message fits (the
  // demo week does; render.test.ts checks it on a fixed message).
  const french = counts.get('?lang=fr')!;
  const english = counts.get('?lang=en&download=1')!;
  expect(french).toBeGreaterThanOrEqual(1);
  expect(english).toBeGreaterThanOrEqual(1);
  expect(counts.get('')).toBe(french + english);
  expect(counts.get('?lang=both')).toBe(french + english);
  // Only a week's message, in a language it has, for the class team.
  for (const path of [
    `${base}?lang=es`,
    `/classes/${SEED.class3}/info-parents/${weeks.nextWeek}/pdf`,
    `/classes/${SEED.class3}/info-parents/${addDays(weeks.thisWeek, 1)}/pdf`,
    `/classes/${SEED.class5}/info-parents/${weeks.thisWeek}/pdf`,
    `/classes/not-a-class/info-parents/${weeks.thisWeek}/pdf`,
  ]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()['cache-control'], path).toBe('private, no-store');
  }

  // The buttons check first, as copying does, then open the chosen language's PDF.
  const share = page.getByRole('group', { name: 'Imprimer (PDF)' });
  await expect(share.getByRole('button')).toHaveText([
    'Imprimer le français (PDF)',
    'Print the English (PDF)',
    'Imprimer les deux (PDF)',
  ]);
  await share.getByRole('button', { name: 'Print the English (PDF)' }).click();
  const check = page.getByRole('dialog', { name: 'Des élèves sont nommés' });
  await expect(check.getByText(/^Ce message nomme Samuel\./)).toBeVisible();
  await expect(
    check.getByText(
      /^1 paragraphe n’a pas de version anglaise à jour\s:\sil paraîtra en français\.$/,
    ),
  ).toBeVisible();
  await expectAccessible(page);
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/pdf')),
    check.getByRole('button', { name: 'Continuer' }).click(),
  ]);
  expect(new URL(request.url()).pathname).toBe(base);
  expect(new URL(request.url()).search).toBe('?lang=en');
});

test('« Aujourd’hui »: the reminder on the week’s last two school days, while not sent', async ({
  page,
}) => {
  // The class has this week's draft. Whether today is one of the week's last two school days
  // depends on the day the test runs: the demo calendar says (newsletterReminderDue is unit
  // tested).
  const due = await newsletterReminderDueToday(SEED.class3);
  test.info().annotations.push({ type: 'reminder', description: due ? 'due today' : 'not today' });
  await login(page, DEMO.teacher3);
  await page.goto('/today');
  await expect(
    page.getByRole('heading', { name: 'Aujourd’hui', level: 1, exact: true }),
  ).toBeVisible();
  const reminder = page.getByTestId('newsletter-reminder');
  if (!due) {
    await expect(reminder).toHaveCount(0);
    return;
  }
  await expect(reminder).toHaveText(
    /^Info-parents\s:\spréparez le message de la semaine pour 3e année – Mme Tremblay\.Préparer le message$/,
  );
  await expectAccessible(page);
  await reminder.getByRole('link', { name: 'Préparer le message' }).click();
  await page.waitForURL(new RegExp(`/info-parents/${weeks.thisWeek}$`));
  await expect(page.getByTestId('newsletter-editor')).toHaveAttribute('data-ready', 'true');
});

test('« Marquer comme envoyé »: checked first, then « Envoyé » in the list', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await openEditor(page, weeks.thisWeek);
  await page.getByRole('button', { name: 'Marquer comme envoyé' }).click();
  const check = page.getByRole('dialog', { name: 'Des élèves sont nommés' });
  await expect(check.getByText(/^Ce message nomme Samuel\./)).toBeVisible();
  await check.getByRole('button', { name: 'Continuer' }).click();
  await expect(
    page.getByText(/^Envoyé le .+\. Remettez-le en brouillon pour le modifier\.$/),
  ).toBeVisible();
  await expect(page.getByLabel('Signature')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Remettre en brouillon' })).toBeVisible();
  expect((await newsletterOf(SEED.class3, weeks.thisWeek))?.status).toBe('sent');
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Tous les messages' }).click();
  await page.waitForURL(/\/info-parents$/);
  const row = page.getByRole('link', { name: /^Semaine du / });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/Envoyé le /);
  // The week is no longer offered; next week still is.
  await expect(page.getByRole('link', { name: /^Préparer la semaine du / })).toHaveCount(1);
  // Sent: « Aujourd'hui » no longer reminds about it.
  await page.goto('/today');
  await expect(
    page.getByRole('heading', { name: 'Aujourd’hui', level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('newsletter-reminder')).toHaveCount(0);
});
