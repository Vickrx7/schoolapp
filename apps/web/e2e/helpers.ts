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

/** Signs in through the real email-code flow (codes are read from the local Mailpit). */
export async function login(page: Page, email: string) {
  await page.goto('/login');
  const started = Date.now();
  await page.getByLabel('Adresse courriel').fill(email);
  await page.getByRole('button', { name: 'Recevoir un code' }).click();
  await expect(page.getByLabel('Code à 6 chiffres')).toBeVisible();
  const code = await latestCode(email, started);
  await page.getByLabel('Code à 6 chiffres').fill(code);
  await page.getByRole('button', { name: 'Me connecter' }).click();
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
