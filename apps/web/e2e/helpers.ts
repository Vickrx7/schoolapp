import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

export const DEMO = {
  teacher3: 'isabelle.tremblay@demo.lynx.test',
  teacher5: 'marc.gagnon@demo.lynx.test',
  rotary: 'paul.leblanc@demo.lynx.test',
  principal: 'sophie.lavoie@demo.lynx.test',
  office: 'julie.bergeron@demo.lynx.test',
};

async function latestCode(email: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=5`,
    );
    const body = (await res.json()) as { messages?: { ID: string; Created: string }[] };
    const msg = body.messages?.find((m) => new Date(m.Created).getTime() >= after - 2000);
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
        Text: string;
        HTML: string;
      };
      const code = /\b(\d{6})\b/.exec(full.Text || full.HTML)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no login code arrived for ${email}`);
}

/**
 * Signs in through the real email-code flow (codes are read from the local Mailpit).
 * Works whichever language the login page is in.
 */
export async function login(page: Page, email: string, { stayOnPage = false } = {}) {
  if (!stayOnPage) await page.goto('/login');
  const started = Date.now();
  await page.getByLabel(/^(Adresse courriel|Email address)$/).fill(email);
  const codeField = page.getByLabel(/^(Code à 6 chiffres|6-digit code)$/);
  const tooSoon = page.getByText(/^(Trop de tentatives|Too many attempts)/);
  // Auth allows one code per address per second; signing in twice in a row can hit that.
  for (let attempt = 0; ; attempt++) {
    await page.getByRole('button', { name: /^(Recevoir un code|Send me a code)$/ }).click();
    await expect(codeField.or(tooSoon)).toBeVisible();
    if (await codeField.isVisible()) break;
    if (attempt === 3) throw new Error(`login codes for ${email} are rate limited`);
    await page.waitForTimeout(1500);
  }
  const code = await latestCode(email, started);
  await codeField.fill(code);
  await page.getByRole('button', { name: /^(Me connecter|Sign in)$/ }).click();
  await page.waitForURL(/\/(today|calendar)/);
}

// Seeded Mondays without school (see supabase/seed.sql).
const SEEDED_MONDAYS_OFF = new Set(['2026-10-12', '2026-12-21', '2026-12-28']);

/** A coming Monday with school and no seeded check-offs (as YYYY-MM-DD). */
export function nextSchoolMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - (d.getUTCDay() || 7)) % 7 || 7));
  while (SEEDED_MONDAYS_OFF.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** Fails on serious or critical WCAG 2 A/AA violations. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
}

/** Seeded days without school (see supabase/seed.sql): PA days and holidays. */
const SEEDED_DAYS_OFF = new Set([
  '2026-10-09',
  '2026-10-12',
  '2026-11-20',
  ...Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 11, 21 + i));
    return d.toISOString().slice(0, 10);
  }),
]);

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Adds days to a YYYY-MM-DD date. */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/**
 * A school day at least `weeksAhead` weeks from today on the given ISO weekday (2 = Tuesday ...
 * 5 = Friday), skipping the seeded days off. Mondays are left to teacher.spec.ts, which checks
 * off lessons on them.
 */
export function schoolDay({ weeksAhead, isoWeekday }: { weeksAhead: number; isoWeekday: number }) {
  if (isoWeekday < 2 || isoWeekday > 5) throw new Error('pick Tuesday to Friday');
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  while ((d.getUTCDay() || 7) !== isoWeekday || SEEDED_DAYS_OFF.has(iso(d))) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return iso(d);
}

/** Whether a date is a seeded school day (a weekday that is not a seeded day off). */
export function isSeededSchoolDay(date: string): boolean {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !SEEDED_DAYS_OFF.has(date);
}

/** The coming Friday (today on a Friday), as the seed places its relative mass. */
export function comingFriday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((5 - (d.getUTCDay() || 7) + 7) % 7));
  return iso(d);
}

/** A chip of the absence form (a radio button or a checkbox drawn as a button). */
export const chip = (page: Page, name: string) =>
  page.locator('label').filter({ hasText: new RegExp(`^${name}$`) });

/**
 * Reports an absence through « Signaler une absence »: « Autre date », « Plusieurs jours » for
 * a range, a half day if asked, then « Envoyer ». Waits for the absence page.
 */
export async function reportAbsence(
  page: Page,
  options: { startsOn: string; endsOn?: string; part?: 'Matin' | 'Après-midi' },
) {
  await page.goto('/absences/new');
  const dateField = page.getByLabel('Date', { exact: true });
  // A tap before the page is interactive is lost: retry until the date field shows.
  await expect(async () => {
    if (!(await dateField.isVisible())) await chip(page, 'Autre date').click();
    await expect(dateField).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dateField.fill(options.startsOn);
  if (options.endsOn) {
    await chip(page, 'Plusieurs jours').click();
    await page.getByLabel('Dernier jour').fill(options.endsOn);
  }
  if (options.part) await chip(page, options.part).click();
  // The summary is built by the server from the same plans « Envoyer » publishes.
  await expect(page.getByTestId('absence-summary')).toContainText('à couvrir');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await page.waitForURL(/\/absences\/[0-9a-f-]{36}$/);
}

/** The instant a school-local (America/Toronto) date and time falls on, e.g. for page.clock. */
export function torontoInstant(date: string, time: string): Date {
  for (const offset of ['-04:00', '-05:00']) {
    const instant = new Date(`${date}T${time}:00${offset}`);
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(instant);
    if (local === time) return instant;
  }
  throw new Error(`no Toronto instant for ${date} ${time}`);
}
