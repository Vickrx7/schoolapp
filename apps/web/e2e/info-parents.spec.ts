import { addDays } from '@lynx/domain';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  SEED,
  clearProgress,
  closeDb,
  deleteEvent,
  insertSchoolEvent,
  nextLesson,
  setProgress,
} from './db';
import { deleteNewsletters, demoWeeks, newsletterOf } from './db-newsletters';
import { DEMO, e2ePrefix, expectAccessible, login } from './helpers';

/**
 * « Info-parents » (DECISIONS D-136 to D-138), desktop, as Isabelle (3e année): the week's message
 * drafted from the class's own data (a lesson taught this week, an event next week with notes for
 * staff that never appear, a tip from the library's family guide with its English, an English
 * greeting), then edited (a student named, the typography fixed, the English written by hand, an
 * app line edited so its English is « à mettre à jour »), copied in both languages after « Des
 * élèves sont nommés », and marked sent. The app sends nothing: the clipboard is the browser's.
 * The messages, the event and the progress made here are deleted.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = `${e2ePrefix('ip')} Spectacle de la chorale`;
const NOTES = 'Note au personnel : arriver à 8 h 30 au gymnase.';
let eventId: string | null = null;
let lessonId: string | null = null;
let weeks: Awaited<ReturnType<typeof demoWeeks>>;

test.beforeAll(async () => {
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
  // Nothing is copied or marked sent before a save.
  await expect(page.getByRole('button', { name: 'Copier les deux' })).toBeDisabled();
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
});
