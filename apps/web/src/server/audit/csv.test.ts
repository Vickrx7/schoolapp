import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import { auditCsv } from './csv';
import { asAuditT } from './labels';
import type { AuditRow } from './rows';

const tFr = asAuditT(createTranslator({ locale: 'fr-CA', messages: fr }));
const tEn = asAuditT(createTranslator({ locale: 'en-CA', messages: en }));

const substituteViewedAlerts: AuditRow = {
  id: 12,
  occurred_at: '2026-11-12T12:52:00Z',
  action: 'student_alert.viewed',
  category: 'alerts',
  actor_type: 'substitute',
  actor_user_id: null,
  actor_label: null,
  issuer_label: 'Julie Bergeron',
  subject_label: null,
  school_id: 'c0000000-0000-4000-8000-000000000001',
  school_name: 'É.É.C. Saint-Exemple',
  entity_type: 'class',
  entity_id: 'e0000000-0000-4000-8000-000000000003',
  entity_label: '3e année – Mme Tremblay',
  details: { alert_count: 2, issued_by_role: 'office' },
  flags: ['office_issued_code'],
};

const roleGranted: AuditRow = {
  ...substituteViewedAlerts,
  id: 11,
  occurred_at: '2026-11-12T13:05:00Z',
  action: 'user_role.granted',
  category: 'access',
  actor_type: 'user',
  actor_user_id: 'd0000000-0000-4000-8000-000000000006',
  actor_label: '=HYPERLINK("http://x")',
  issuer_label: null,
  entity_type: 'user',
  entity_label: 'Marc Gagnon',
  details: { role: 'teacher' },
  flags: [],
};

const lines = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n');

describe('auditCsv (D-103)', () => {
  it('writes a French file: byte order mark, `;`, the header, then one line per entry', () => {
    const csv = auditCsv([substituteViewedAlerts, roleGranted], {
      locale: 'fr-CA',
      timeZone: 'America/Toronto',
      t: tFr,
    });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const [header, first, second, end] = lines(csv);
    expect(header).toBe(
      'Date et heure (heure de l’école);Code de l’action;Action;Personne;Type;Code émis par;Personne concernée;École;Type d’élément;Élément;Détails;Indicateurs',
    );
    expect(first).toBe(
      [
        '2026-11-12 07:52',
        'student_alert.viewed',
        'Alertes de sécurité ou médicales consultées (2 alertes)',
        '',
        'Personne suppléante',
        'Julie Bergeron (secrétariat)',
        '',
        'É.É.C. Saint-Exemple',
        'Classe',
        '3e année – Mme Tremblay',
        '"alert_count=2; issued_by_role=office"',
        'Code émis par le secrétariat',
      ].join(';'),
    );
    // A label that starts like a formula is never run by a spreadsheet; a cell holding `;` or
    // `"` is quoted.
    expect(second).toBe(
      [
        '2026-11-12 08:05',
        'user_role.granted',
        'Rôle accordé : Marc Gagnon (Enseignant·e)',
        '"\'=HYPERLINK(""http://x"")"',
        'Personnel',
        '',
        '',
        'É.É.C. Saint-Exemple',
        'Personne',
        'Marc Gagnon',
        'role=teacher',
        '',
      ].join(';'),
    );
    expect(end).toBe('');
  });

  it('writes an English file with commas', () => {
    const csv = auditCsv([substituteViewedAlerts], {
      locale: 'en-CA',
      timeZone: 'America/Toronto',
      t: tEn,
    });
    const [header, first] = lines(csv);
    expect(header).toBe(
      'Date and time (school time),Action code,Action,Person,Type,Code issued by,Person concerned,School,Item type,Item,Details,Flags',
    );
    expect(first).toContain(',Substitute,Julie Bergeron (office),');
    expect(first).toContain(',Safety or medical alerts viewed (2 alerts),');
    expect(first).toContain(',alert_count=2; issued_by_role=office,Code issued by the office');
  });

  it('shows a student only as their class', () => {
    const csv = auditCsv(
      [
        {
          ...substituteViewedAlerts,
          action: 'student_alert.created',
          actor_type: 'user',
          actor_label: 'Isabelle Tremblay',
          issuer_label: null,
          entity_type: 'student',
          details: { category: 'medical' },
          flags: [],
        },
      ],
      { locale: 'fr-CA', timeZone: 'America/Toronto', t: tFr },
    );
    expect(lines(csv)[1]).toContain(';Élève;Élève · 3e année – Mme Tremblay;category=medical;');
  });

  it('is just the header when there is nothing to export', () => {
    expect(
      lines(auditCsv([], { locale: 'fr-CA', timeZone: 'America/Toronto', t: tFr })),
    ).toHaveLength(2);
  });
});
