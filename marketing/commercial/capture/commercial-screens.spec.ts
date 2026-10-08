/**
 * Screens for the commercial (marketing/commercial on claude/nifty-fermat-8hhl1l). Not a test:
 * it walks the demo with the seed data and saves screenshots plus the boxes of the elements the
 * video points at. Run on a fresh `stack.sh reset`, then reset again.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { seedItemId } from '@lynx/content';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  cleanupAbsences,
  clearAttempts,
  closeDb,
  deleteAlertsFor,
  deleteSampleClasses,
  deleteStaff,
  openCodeWindow,
  planIdOn,
  query,
  resetLanguage,
  SEED,
} from './db';
import {
  acceptWelcome,
  addDaysIso,
  DEMO,
  isSeededSchoolDay,
  login,
  reportAbsence,
  torontoInstant,
} from './helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(900_000);

const OUT = process.env.COMMERCIAL_OUT ?? '/home/user/schoolapp/marketing/commercial/screens';
const ALERT = 'Allergie aux arachides, auto-injecteur dans le sac (démonstration)';
const QUIZ = seedItemId('demo', 'quiz-nombres-1000');
const INVITEE = {
  email: `chantal-${Date.now().toString(36)}@demo.lynx.test`,
  name: 'Chantal Demers',
};

const schoolToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
function nextSchoolDay(after: string): string {
  let d = addDaysIso(after, 1);
  while (!isSeededSchoolDay(d)) d = addDaysIso(d, 1);
  return d;
}
const ABS_DAY = nextSchoolDay(schoolToday());
const DAY2 = nextSchoolDay(ABS_DAY);

const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 };

async function ctx(browser: Browser, kind: 'phone' | 'desktop'): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: 'http://localhost:3000',
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    ...(kind === 'phone' ? PHONE : DESKTOP),
  });
}

type Boxes = Record<string, Locator>;

/** Saves `<name>.png` and `<name>.json` (boxes in screenshot pixels). */
async function shot(
  page: Page,
  name: string,
  boxes: Boxes = {},
  opts: { fullPage?: boolean; clip?: Locator } = {},
) {
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.mouse.move(0, 0).catch(() => {});
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
          ),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  let origin = { x: 0, y: 0 };
  if (opts.clip) {
    const b = await opts.clip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY };
    });
    origin = b;
  } else if (!opts.fullPage) {
    origin = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  }
  const out: Record<string, number[]> = {};
  for (const [key, loc] of Object.entries(boxes)) {
    try {
      const b = await loc.first().evaluate(
        (el) => {
          const r = el.getBoundingClientRect();
          return [r.x + window.scrollX, r.y + window.scrollY, r.width, r.height];
        },
        undefined,
        { timeout: 3000 },
      );
      out[key] = [(b[0]! - origin.x) * dpr, (b[1]! - origin.y) * dpr, b[2]! * dpr, b[3]! * dpr].map(
        Math.round,
      );
    } catch {
      console.log(`  box ${name}.${key} missing`);
    }
  }
  if (opts.fullPage) {
    // Fixed bars (the phone's bottom navigation) would be painted mid-page: the video adds them back.
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (getComputedStyle(el).position === 'fixed') {
          (el as HTMLElement).dataset.commercialHidden = '1';
          (el as HTMLElement).style.visibility = 'hidden';
        }
      }
    });
  }
  if (opts.clip) await opts.clip.first().screenshot({ path: `${OUT}/${name}.png` });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.fullPage });
  if (opts.fullPage) {
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('[data-commercial-hidden]'))) {
        (el as HTMLElement).style.visibility = '';
        delete (el as HTMLElement).dataset.commercialHidden;
      }
    });
  }
  await writeFile(`${OUT}/${name}.json`, JSON.stringify({ dpr, boxes: out }, null, 1));
  console.log(`  -> ${name}`);
}

async function settle(page: Page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(1200);
}

async function attempt(label: string, fn: () => Promise<void>) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out after 90 s')), 90_000),
      ),
    ]);
  } catch (e) {
    console.log(`!! ${label} failed: ${(e as Error).message.split('\n')[0]}`);
  }
}

async function clickUntil(button: Locator, then: Locator) {
  await expect(async () => {
    if (!(await then.isVisible())) await button.click();
    await expect(then).toBeVisible({ timeout: 1500 });
  }).toPass();
}
const chipIn = (scope: Locator, name: string) =>
  scope.locator('label').filter({ hasText: new RegExp(`^${name}$`) });

let teacherPhone: Page;
let teacherDesk: Page;
let absenceId = '';
let planId = '';
let code = '';

async function removeDemoData() {
  await cleanupAbsences(DEMO.teacher3);
  await deleteAlertsFor('Samuel', SEED.class3);
  await clearAttempts();
  await query(
    `delete from public.ai_jobs j using public.users u where j.user_id = u.id and u.email = $1`,
    [DEMO.teacher3],
  );
  await deleteSampleClasses(INVITEE.email).catch(() => {});
  await deleteStaff(INVITEE.email).catch(() => {});
}

test.beforeAll(async ({ browser }) => {
  console.log(`absence day ${ABS_DAY}, today captures ${DAY2}`);
  await removeDemoData();
  await resetLanguage(DEMO.teacher3);
  await resetLanguage(DEMO.office);
  await query('update public.schools set ai_enabled = true where id = $1', [SEED.school]);
  const p = await (await ctx(browser, 'phone')).newPage();
  await login(p, DEMO.teacher3);
  teacherPhone = p;
  const d = await (await ctx(browser, 'desktop')).newPage();
  await login(d, DEMO.teacher3);
  teacherDesk = d;
  // An alert for Samuel, as Isabelle records it (never shown on screen).
  await d.goto(`/classes/${SEED.class3}/students`);
  await clickUntil(
    d.getByRole('button', { name: 'Alerte de sécurité ou médicale' }),
    d.getByRole('button', { name: 'Ajouter une alerte' }).first(),
  );
  await shot(d, 'students-desktop', {
    alertButton: d.getByRole('button', { name: 'Ajouter une alerte' }).first(),
  });
  const row = d.getByRole('listitem').filter({ has: d.locator('input[value="Samuel"]') });
  await row.getByRole('button', { name: 'Ajouter une alerte' }).click();
  await row.getByLabel('Description').fill(ALERT);
  await row.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(d.getByText('Alerte enregistrée.')).toBeVisible();
});

test.afterAll(async () => {
  await removeDemoData();
  await resetLanguage(DEMO.teacher3);
  await query('update public.schools set ai_enabled = false where id = $1', [SEED.school]);
  await closeDb();
});

test('teacher: Aujourd’hui, Leçon donnée, calendar days, English', async () => {
  const p = teacherPhone;
  await attempt('today', async () => {
    await p.goto(`/today?date=${DAY2}`);
    await expect(p.getByText('Entrée, prière du matin et O Canada').first()).toBeVisible();
    const boxes = {
      prayer: p.getByText('Entrée, prière du matin et O Canada').first(),
      next: p.getByText(/^Prochaine leçon ·/).first(),
      taught: p.getByRole('button', { name: 'Leçon donnée' }).first(),
      absent: p.getByRole('link', { name: 'Je suis absent·e' }),
    };
    await shot(p, 'today-phone', boxes);
    await shot(p, 'today-phone-full', boxes, { fullPage: true });
  });
  await attempt('taught', async () => {
    const btn = p.getByRole('button', { name: 'Leçon donnée' }).first();
    await btn.scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -200));
    await shot(p, 'taught-before', { taught: btn });
    await btn.click();
    const undo = p.getByRole('button', { name: 'Annuler' }).first();
    await expect(undo).toBeVisible();
    await shot(p, 'taught-after', { undo });
    await undo.click();
    await expect(p.getByRole('button', { name: 'Leçon donnée' }).first()).toBeVisible();
  });
  await attempt('pa day', async () => {
    await p.goto('/today?date=2026-10-09');
    await settle(p);
    await shot(p, 'pa-day-phone');
  });
  await attempt('early dismissal', async () => {
    await p.goto('/today?date=2026-11-19');
    await settle(p);
    await shot(p, 'early-phone', {}, { fullPage: true });
  });
  await attempt('mass', async () => {
    const [mass] = await query<{ starts_on: string }>(
      `select to_char(starts_on, 'YYYY-MM-DD') as starts_on from public.school_calendar_events
       where event_type = 'mass' and starts_on >= current_date order by starts_on limit 1`,
    );
    console.log(`  mass on ${mass?.starts_on}`);
    if (mass) {
      await p.goto(`/today?date=${mass.starts_on}`);
      await settle(p);
      await shot(p, 'mass-phone', { mass: p.getByText(/[Mm]esse/).first() }, { fullPage: true });
    }
  });
  await attempt('english', async () => {
    await p.goto('/profile');
    await p.getByLabel('Langue de l’application').selectOption('en-CA');
    await p.waitForTimeout(1500);
    await p.goto(`/today?date=${DAY2}`);
    await expect(p.getByRole('button', { name: 'Lesson taught' }).first()).toBeVisible();
    await shot(p, 'today-phone-en');
    await p.goto('/profile');
    await p.getByLabel('App language').selectOption('fr-CA');
    await p.waitForTimeout(1500);
  });
  await resetLanguage(DEMO.teacher3);
});

test('teacher desktop: timetable, unit, year, coverage, library, differentiate', async () => {
  const d = teacherDesk;
  await attempt('timetable', async () => {
    await d.goto(`/classes/${SEED.class3}/timetable`);
    await settle(d);
    await shot(d, 'timetable-desktop');
  });
  await attempt('unit', async () => {
    await d.goto(`/classes/${SEED.class3}/planning`);
    await settle(d);
    await shot(d, 'planning-desktop');
    const unit = d
      .locator(`a[href*="/classes/${SEED.class3}/planning/"]`)
      .filter({ hasNotText: /Mon année|Couverture|Unités/ });
    await unit.first().click();
    await settle(d);
    await shot(d, 'unit-desktop');
  });
  await attempt('year', async () => {
    await d.goto(`/classes/${SEED.class3}/planning/year`);
    await settle(d);
    await shot(d, 'year-desktop', {
      pdf: d.getByRole('link', { name: /Plan à long terme/ }).first(),
    });
    await shot(d, 'year-desktop-full', {}, { fullPage: true });
  });
  await attempt('coverage', async () => {
    await d.goto(`/classes/${SEED.class3}/planning/coverage`);
    await settle(d);
    await shot(d, 'coverage-desktop', {}, { fullPage: true });
    await teacherPhone.goto(`/classes/${SEED.class3}/planning/coverage`);
    await settle(teacherPhone);
    await shot(teacherPhone, 'coverage-phone-full', {}, { fullPage: true });
  });
  await attempt('library search', async () => {
    await d.goto('/library?q=huard');
    await settle(d);
    await shot(d, 'library-search', { search: d.getByRole('searchbox').first() });
  });
  await attempt('library item', async () => {
    const link = d.getByRole('link', { name: /huard/i }).first();
    await link.click();
    await d.waitForURL(/\/library\/items\//);
    await settle(d);
    await shot(d, 'library-item', {});
    await shot(d, 'library-item-full', {}, { fullPage: true });
  });
  await attempt('library review', async () => {
    await d.goto('/library/mine');
    await settle(d);
    await shot(d, 'library-mine');
  });
  await attempt('differentiate', async () => {
    await d.goto('/differentiate');
    await expect(d.getByRole('heading', { name: 'Texte différencié' })).toBeVisible();
    await d.getByLabel('Titre').fill('Le castor, ingénieur de la nature');
    await d
      .getByLabel('Texte, consignes ou activité')
      .fill(
        'Zoé et Samuel observent un castor près de la rivière. Le castor coupe des branches avec ses dents et construit un barrage. Il vit en famille dans une hutte.',
      );
    await shot(d, 'differentiate-form', {}, { fullPage: true });
    await d.getByRole('button', { name: 'Vérifier avant d’envoyer' }).click();
    await expect(d.locator('mark', { hasText: 'Élève A' })).toBeVisible();
    const mark = d.locator('mark', { hasText: 'Élève A' }).first();
    await mark.scrollIntoViewIfNeeded();
    await d.evaluate(() => window.scrollBy(0, 160));
    await shot(d, 'differentiate-preview', {
      markA: mark,
      markB: d.locator('mark', { hasText: 'Élève B' }).first(),
      send: d.getByRole('button', { name: 'Envoyer à l’IA' }),
    });
    await shot(d, 'differentiate-preview-full', {}, { fullPage: true });
  });
  await attempt('projector', async () => {
    await d.goto(`/library/items/${QUIZ}`);
    await d.getByRole('link', { name: 'Présenter à la classe' }).click();
    await d.waitForURL(/\/projector\/items\//);
    const question = d.getByRole('heading', { level: 2, name: /^Question 1 sur \d+$/ });
    await expect(async () => {
      await d.keyboard.press('Home');
      await d.keyboard.press('ArrowRight');
      await expect(question).toBeVisible({ timeout: 1000 });
    }).toPass();
    await shot(d, 'projector-question');
    await d.getByRole('button', { name: 'Afficher la réponse' }).click();
    await expect(d.getByRole('listitem').filter({ hasText: '407' })).toContainText('Bonne réponse');
    await shot(d, 'projector-answer');
  });
  await attempt('info-parents', async () => {
    await d.goto(`/classes/${SEED.class3}/info-parents`);
    await settle(d);
    await shot(d, 'info-parents-list');
    const week = d
      .getByRole('link', { name: /^Préparer la semaine du 28/ })
      .or(d.getByRole('button', { name: /^Préparer la semaine du 28/ }));
    await week.first().click();
    await settle(d);
    const prep = d.getByRole('button', { name: /Préparer le message/ }).first();
    if (await prep.isVisible()) await prep.click();
    {
      await d.waitForURL(/info-parents\/\d{4}-\d{2}-\d{2}/, { timeout: 30_000 }).catch(() => {});
      await settle(d);
      await shot(d, 'info-parents-editor');
      await shot(d, 'info-parents-editor-full', {}, { fullPage: true });
    }
  });
  await attempt('bulletins', async () => {
    await d.goto(`/classes/${SEED.class3}/bulletins`);
    await settle(d);
    await shot(d, 'bulletins-desktop');
  });
});

test('absence: two taps, the plan, the office code, the substitute, the report', async ({
  browser,
}) => {
  const p = teacherPhone;
  // Tap 1 shows the form; the screenshot is the form with « Envoyer ».
  await attempt('absence form', async () => {
    await p.goto(`/today?date=${ABS_DAY}`);
    await p.getByRole('link', { name: 'Je suis absent·e' }).click();
    await p.waitForURL(/\/absences\/new/);
    await settle(p);
    await shot(p, 'absence-form', { send: p.getByRole('button', { name: 'Envoyer' }) });
  });
  await reportAbsence(p, { startsOn: ABS_DAY });
  absenceId = /\/absences\/([0-9a-f-]{36})$/.exec(p.url())![1]!;
  planId = await planIdOn(absenceId, ABS_DAY);
  await attempt('absence sent', async () => {
    await expect(p.getByTestId('plan-status').first()).toContainText(
      'Prêt · publié automatiquement',
    );
    await shot(p, 'absence-sent', { status: p.getByTestId('plan-status').first() });
  });
  const d = teacherDesk;
  await d.goto(`/absences/${absenceId}/plans/${planId}`);
  await attempt('plan review', async () => {
    await expect(d.getByTestId('plan-group').filter({ hasText: 'Samuel' })).toBeVisible();
    await shot(d, 'plan-desktop', { group: d.getByTestId('plan-group').first() });
    await shot(d, 'plan-desktop-full', {}, { fullPage: true });
  });
  await d.getByRole('button', { name: 'Publier maintenant' }).click();
  await expect(d.getByTestId('plan-status').first()).toHaveText('Publié');

  // The office.
  const office = await (await ctx(browser, 'desktop')).newPage();
  await login(office, DEMO.office);
  await office.goto(`/absences?date=${ABS_DAY}`);
  const row = office.getByTestId('sub-day-row').filter({ hasText: 'Mme Tremblay' });
  await expect(row.getByTestId('board-status')).toContainText('Publié');
  await shot(office, 'office-before', { row });
  await clickUntil(
    row.getByRole('button', { name: 'Générer un code' }),
    office.getByTestId('sub-code'),
  );
  code = (await office.getByTestId('sub-code').textContent())!.trim();
  await shot(office, 'office-code', {
    code: office.getByTestId('sub-code'),
    dialog: office.getByRole('dialog'),
  });
  await office.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
  await expect(row).toContainText('1 code actif');

  // The substitute, on a phone, at 11 h 20 on the day.
  await openCodeWindow(planId);
  const subCtx = await ctx(browser, 'phone');
  const sub = await subCtx.newPage();
  await sub.clock.setFixedTime(torontoInstant(ABS_DAY, '11:20'));
  await sub.goto('/s');
  await sub.waitForURL(/\/suppleance$/);
  await shot(sub, 'sub-code-entry');
  await sub.getByLabel('Code d’accès').fill(code.toLowerCase());
  await sub.getByRole('button', { name: 'Commencer' }).click();
  await sub.waitForURL(/\/suppleance\/plan$/);
  await expect(sub.getByText('Entrée, prière du matin et O Canada').first()).toBeVisible();
  await shot(sub, 'sub-plan', {
    now: sub.getByText(/^Maintenant/).first(),
    next: sub.getByText(/^Ensuite/).first(),
  });
  await shot(sub, 'sub-plan-full', {}, { fullPage: true });
  await sub.getByRole('tab', { name: 'Élèves' }).click();
  await expect(sub.getByText(ALERT)).toHaveCount(0);
  await shot(sub, 'sub-students', {
    alerts: sub.getByRole('button', { name: 'Alertes de sécurité ou médicales' }),
  });
  // Revealed and hidden again (the reveal is logged); never captured.
  await sub.getByRole('button', { name: 'Alertes de sécurité ou médicales' }).click();
  await expect(sub.getByText(ALERT)).toBeVisible();
  await sub.getByRole('button', { name: 'Masquer les alertes' }).click();

  await sub.getByRole('tab', { name: 'Fin de journée' }).click();
  await sub.getByRole('link', { name: 'Remplir le suivi de la journée' }).click();
  await sub.waitForURL(/\/suppleance\/report$/);
  const lesson = sub.getByTestId('report-lesson').first();
  await expect(async () => {
    await chipIn(lesson, 'Terminé').click();
    await expect(lesson.getByRole('radio', { name: 'Terminé' })).toBeChecked({ timeout: 1000 });
  }).toPass();
  await sub
    .getByLabel('Comportement et événements')
    .fill('Très bonne journée; le groupe a bien travaillé.');
  await shot(sub, 'sub-report', { send: sub.getByRole('button', { name: 'Envoyer le suivi' }) });
  await shot(sub, 'sub-report-full', {}, { fullPage: true });
  await sub.getByRole('button', { name: 'Envoyer le suivi' }).click();
  await sub.waitForURL(/\/suppleance\/done$/);
  await shot(sub, 'sub-done');

  await office.goto(`/absences?date=${ABS_DAY}`);
  await expect(row.getByTestId('board-report')).toHaveText('Suivi reçu');
  await shot(office, 'office-after', { row });

  // Isabelle reads it.
  await d.goto('/today');
  const banner = d.getByTestId('report-banner');
  await expect(banner).toContainText('Le suivi de la suppléance du');
  await shot(d, 'report-banner-desktop', { banner });
  await banner.getByRole('link', { name: 'Voir le suivi' }).click();
  await d.waitForURL(/\/report$/);
  await shot(d, 'report-desktop', {
    confirm: d.getByRole('button', { name: 'Confirmer le suivi' }),
  });
  await shot(d, 'report-desktop-full', {}, { fullPage: true });
  await p.goto(d.url());
  await shot(p, 'report-phone-full', {}, { fullPage: true });
  await subCtx.close();
  await office.context().close();
});

test('principal: dashboard, audit, École', async ({ browser }) => {
  const s = await (await ctx(browser, 'desktop')).newPage();
  await login(s, DEMO.principal);
  await expect(s).toHaveURL(/\/direction$/);
  const absence = s.getByTestId('direction-absence').filter({ hasText: 'Mme Tremblay' });
  const nextDay = s.locator('summary', { hasText: 'Prochain jour d’école' });
  if ((await nextDay.count()) > 0 && !(await absence.isVisible())) await nextDay.click();
  await attempt('direction', async () => {
    await expect(absence).toContainText('Suivi reçu');
    await shot(s, 'direction-desktop', { absence });
    await shot(s, 'direction-desktop-full', {}, { fullPage: true });
  });
  await attempt('audit', async () => {
    await s.goto('/audit');
    await s.getByLabel('Catégorie').selectOption({ label: 'Alertes' });
    await s.getByRole('button', { name: 'Afficher', exact: true }).click();
    await expect(s).toHaveURL(/[?&]category=alerts(&|$)/);
    const entry = s
      .getByRole('table')
      .getByRole('row')
      .filter({ hasText: 'Alertes de sécurité ou médicales consultées' })
      .first();
    await expect(entry).toContainText('Code émis par le secrétariat');
    await shot(s, 'audit-desktop', {
      entry,
      badge: entry.getByText('Code émis par le secrétariat'),
    });
  });
  await attempt('school ai', async () => {
    await s.goto('/school');
    await settle(s);
    await shot(s, 'school-desktop-full', {}, { fullPage: true });
    const card = s.getByRole('heading', { name: /intelligence artificielle|IA/i }).first();
    await card.scrollIntoViewIfNeeded();
    await s.evaluate(() => window.scrollBy(0, -120));
    await shot(s, 'school-ai', { heading: card });
  });
  await s.context().close();
});

test('board: Conseil, staff, usage, invitation; new teacher onboarding', async ({ browser }) => {
  const a = await (await ctx(browser, 'desktop')).newPage();
  await login(a, DEMO.boardAdmin);
  await expect(a).toHaveURL(/\/board$/);
  await attempt('board', async () => {
    await shot(a, 'board-desktop', {});
    await shot(a, 'board-desktop-full', {}, { fullPage: true });
  });
  const blurEmails = () =>
    a.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('td, dd, span, p, a, li, div'))) {
        if (el.children.length === 0 && /@/.test(el.textContent ?? ''))
          (el as HTMLElement).style.filter = 'blur(5px)';
      }
    });
  await attempt('usage', async () => {
    await a.goto('/board/usage');
    await settle(a);
    await shot(a, 'board-usage');
  });
  await attempt('years', async () => {
    await a.goto('/board/years');
    await settle(a);
    await shot(a, 'board-years');
  });
  await attempt('reviewers', async () => {
    await a.goto('/board/reviewers');
    await settle(a);
    await blurEmails();
    await shot(a, 'board-reviewers');
  });
  await a.goto('/board/staff');
  await settle(a);
  await attempt('staff', async () => {
    await blurEmails();
    await shot(a, 'board-staff');
  });
  const dialog = a.getByRole('dialog');
  await clickUntil(a.getByRole('button', { name: 'Inviter une personne' }), dialog);
  await dialog.getByLabel('Courriel', { exact: true }).fill(INVITEE.email);
  await dialog.getByLabel('Titre', { exact: true }).selectOption('Mme');
  await dialog.getByLabel('Nom complet').fill(INVITEE.name);
  await dialog.getByLabel('Rôle').selectOption({ label: 'Enseignant·e' });
  await blurEmails();
  await shot(a, 'board-invite', { dialog });
  await dialog.getByRole('button', { name: 'Inviter', exact: true }).click();
  await a.waitForURL(/\/board\/staff\/invitations\/[0-9a-f-]{36}/);
  await expect(a.getByTestId('invite-message')).toContainText('code à 6 chiffres', {
    timeout: 30_000,
  });
  await blurEmails();
  await shot(a, 'board-invited', { message: a.getByTestId('invite-message') });

  const t = await (await ctx(browser, 'phone')).newPage();
  await login(t, INVITEE.email);
  await acceptWelcome(t, { honorific: 'Mme' });
  await t.goto('/demarrage');
  await expect(t.getByTestId('onboarding-checklist')).toContainText('0 sur 4');
  await shot(t, 'start-phone', { checklist: t.getByTestId('onboarding-checklist') });
  await shot(t, 'start-phone-full', {}, { fullPage: true });
  await t.getByRole('button', { name: 'Essayer avec une classe exemple (3e)' }).click();
  await expect(t.getByText('Classe exemple créée.')).toBeVisible();
  await t.getByRole('link', { name: 'Votre classe exemple : Classe exemple (3e année)' }).click();
  await expect(t.getByTestId('sample-notice')).toBeVisible();
  await shot(t, 'sample-class-phone', { notice: t.getByTestId('sample-notice') });
  await attempt('feedback', async () => {
    const fb = t.getByRole('button', { name: 'Commentaires' }).first();
    await shot(t, 'feedback-button-phone', { button: fb });
  });
  await t.context().close();
  await a.context().close();
});
