import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { auditCountBy, closeDb, dbNow, insertAudit, query, SEED } from './db';
import { DEMO, expectAccessible, login } from './helpers';

/**
 * « Journal d'audit » (Phase 6, DECISIONS D-103): the direction reads their school's entries,
 * the office-issued flag included (D-056), and downloads them as a CSV that is itself recorded;
 * a teacher has no log; a board's admins read the board's entries and never the alerts or
 * substitute days of its schools.
 */

test.describe.configure({ mode: 'serial' });

// A board-approved resource of the demo pack that every staff member of the board can read.
const BOARD_ITEM = {
  id: '9f10de3c-3b1e-5110-aebb-c0605e9d0991',
  title: 'Billet de sortie : arrondir à la dizaine',
};
const ALERTS_VIEWED = 'Alertes de sécurité ou médicales consultées (2 alertes)';

test.beforeAll(async () => {
  const [office] = await query<{ id: string }>('select id from public.users where email = $1', [
    DEMO.office,
  ]);
  // A substitute who signed in with a code the office issued read the 3e's alerts.
  await insertAudit({
    action: 'student_alert.viewed',
    boardId: SEED.board,
    schoolId: SEED.school,
    entityType: 'class',
    entityId: SEED.class3,
    details: {
      alert_count: 2,
      issued_by: office!.id,
      issued_by_role: 'office',
      sub_session_id: randomUUID(),
    },
    actorType: 'substitute',
  });
  // The board admin approved a resource for the board.
  await insertAudit({
    action: 'library_item.approved',
    boardId: SEED.board,
    entityType: 'library_item',
    entityId: BOARD_ITEM.id,
    details: { type: 'exit_ticket', revision: 1, faith_reviewed: false },
    actorEmail: DEMO.boardAdmin,
  });
});

test.afterAll(async () => {
  await closeDb();
});

/** The entries' table (desktop); phones get cards instead. */
const table = (page: Page) => page.getByRole('table');

test('the principal filters the alerts and sees the code the office issued', async ({ page }) => {
  await login(page, DEMO.principal);
  await page.goto('/audit');
  await expect(page.getByRole('heading', { level: 1, name: 'Journal d’audit' })).toBeVisible();
  await expect(page.getByText('Qui a consulté ou modifié quoi à votre école')).toBeVisible();

  await page.getByLabel('Catégorie').selectOption({ label: 'Alertes' });
  await page.getByRole('button', { name: 'Afficher', exact: true }).click();
  await expect(page).toHaveURL(/[?&]category=alerts(&|$)/);
  const entry = table(page).getByRole('row').filter({ hasText: ALERTS_VIEWED }).first();
  await expect(entry).toContainText('Personne suppléante');
  await expect(entry).toContainText('code émis par Julie Bergeron (secrétariat)');
  await expect(entry).toContainText('Code émis par le secrétariat');
  await expect(entry).toContainText('3e année – Mme Tremblay');
  // Only alerts.
  await expect(table(page).getByRole('row').filter({ hasText: 'Rôle accordé' })).toHaveCount(0);
  await expectAccessible(page);

  // « Historique de cet élément »: the class's entries only.
  await entry.getByRole('link', { name: 'Historique de cet élément' }).click();
  await expect(page).toHaveURL(new RegExp(`entity=${SEED.class3}`));
  await expect(page.getByText('Entrées d’un seul élément')).toBeVisible();
  await expect(
    table(page).getByRole('row').filter({ hasText: ALERTS_VIEWED }).first(),
  ).toBeVisible();
});

test('the CSV has its header, `;`, no student names, and the export is recorded', async ({
  page,
}) => {
  await login(page, DEMO.principal);
  await page.goto('/audit');
  const since = await dbNow();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Télécharger (CSV)' }).click();
  const file = await readFile((await (await download).path())!, 'utf8');

  expect(file.startsWith('﻿')).toBe(true);
  const [header, ...lines] = file.slice(1).split('\r\n');
  expect(header).toBe(
    'Date et heure (heure de l’école);Code de l’action;Action;Personne;Type;Code émis par;Personne concernée;École;Type d’élément;Élément;Détails;Indicateurs',
  );
  const alertLine = lines.find((line) => line.includes(';student_alert.viewed;'));
  expect(alertLine).toContain(`;${ALERTS_VIEWED};`);
  expect(alertLine).toContain(';Julie Bergeron (secrétariat);');
  expect(alertLine).toContain(';Code émis par le secrétariat');
  // A board's approvals are not the direction's.
  expect(file).not.toContain('library_item.approved');

  // No student's first name, anywhere (D-103: a student is shown only by their class).
  const students = await query<{ first_name: string }>(
    `select distinct s.first_name from public.students s
     join public.classes c on c.id = s.class_id where c.school_id = $1`,
    [SEED.school],
  );
  expect(students.map((s) => s.first_name)).toEqual(
    expect.arrayContaining(['Samuel', 'Aïcha', 'Léa', 'Emma']),
  );
  for (const { first_name: name } of students) {
    expect(file, name).not.toMatch(new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, 'u'));
  }

  // The download itself is in the log (direction and board admins read it).
  await expect.poll(() => auditCountBy('audit_log.exported', DEMO.principal, since)).toBe(1);
  await page.goto(`/audit?school=${SEED.school}&category=audit`);
  await expect(
    table(page)
      .getByRole('row')
      .filter({ hasText: /Journal d’audit exporté \(\d+ entrées?\)/ })
      .first(),
  ).toContainText('Sophie Lavoie');
});

test('a teacher has no audit log', async ({ page }) => {
  await login(page, DEMO.teacher3);
  await page.goto('/audit');
  await expect(page.getByText('Cette page n’existe pas ou vous n’y avez pas accès.')).toBeVisible();
  const response = await page.request.get('/audit/export');
  expect(response.status()).toBe(404);
});

test('the board admin reads the board’s entries, never alerts or substitute days', async ({
  page,
}) => {
  await login(page, DEMO.boardAdmin);
  await expect(page).toHaveURL(/\/board$/);
  const tabs = page.getByRole('navigation', { name: 'Sections de l’administration du conseil' });
  await tabs.getByRole('link', { name: 'Journal d’audit' }).click();
  await expect(page).toHaveURL(new RegExp(`/audit\\?board=${SEED.board}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Journal d’audit' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Journal d’audit' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.getByText(
      'Les consultations d’alertes et la suppléance sont visibles par la direction de chaque école seulement.',
    ),
  ).toBeVisible();

  const approval = table(page)
    .getByRole('row')
    .filter({ hasText: 'Ressource approuvée pour le conseil' })
    .filter({ hasText: BOARD_ITEM.title })
    .first();
  await expect(approval).toContainText('Nathalie Roy');

  // Substitute days and alert access are the school's direction's only (D-056).
  const rows = table(page).getByRole('row');
  await expect(rows.filter({ hasText: 'Alertes de sécurité ou médicales consultées' })).toHaveCount(
    0,
  );
  await expect(rows.filter({ hasText: /suppléance|Personne suppléante|Absence/ })).toHaveCount(0);
  const category = page.getByLabel('Catégorie');
  await expect(category.locator('option', { hasText: 'Suppléance' })).toHaveCount(0);
  await expect(category.locator('option', { hasText: 'Banque de ressources' })).toHaveCount(1);
  await page.goto(`/audit?board=${SEED.board}&category=substitute`);
  await expect(page.getByText('Aucune entrée pour ces filtres.')).toBeVisible();
  await page.goto(`/audit?board=${SEED.board}&category=alerts`);
  await expect(
    table(page).getByRole('row').filter({ hasText: 'Alertes de sécurité ou médicales consultées' }),
  ).toHaveCount(0);

  await page.goto(`/audit?board=${SEED.board}&category=library`);
  await expectAccessible(page);
});
