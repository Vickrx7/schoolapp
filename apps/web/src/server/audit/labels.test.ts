import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import {
  asAuditT,
  auditActor,
  auditDetailsText,
  auditEntity,
  auditEntryView,
  auditIssuer,
  auditSentence,
  auditWhen,
} from './labels';
import { parseAuditRows, type AuditRow } from './rows';

// A message that cannot be formatted (a missing value…) throws instead of falling back.
const strict = {
  onError: (error: Error) => {
    throw error;
  },
};
const tFr = asAuditT(createTranslator({ locale: 'fr-CA', messages: fr, ...strict }));
const tEn = asAuditT(createTranslator({ locale: 'en-CA', messages: en, ...strict }));

const CLASS = 'e0000000-0000-4000-8000-000000000003';

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 1,
    occurred_at: '2026-11-12T12:52:00Z',
    action: 'class.deleted',
    category: 'classes',
    actor_type: 'user',
    actor_user_id: 'd0000000-0000-4000-8000-000000000004',
    actor_label: 'Sophie Lavoie',
    issuer_label: null,
    subject_label: null,
    school_id: 'c0000000-0000-4000-8000-000000000001',
    school_name: 'É.É.C. Saint-Exemple',
    entity_type: 'class',
    entity_id: CLASS,
    entity_label: '3e année – Mme Tremblay',
    details: {},
    flags: [],
    ...overrides,
  };
}

type Tree = { [key: string]: string | Tree };
const actionsOf = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : actionsOf(v, `${prefix}${k}.`),
  );
const ACTIONS = actionsOf((fr as unknown as { audit: { actions: Tree } }).audit.actions);

describe('audit sentences (D-103)', () => {
  it('format every action in both languages, whatever the details hold', () => {
    expect(ACTIONS.length).toBe(62);
    for (const action of ACTIONS) {
      const variants: AuditRow['details'][] = [
        {},
        { role: 'teacher', alert_count: 2, rows: 3, reason: 'support' },
      ];
      for (const details of variants) {
        for (const t of [tFr, tEn]) {
          const sentence = auditSentence(row({ action, details }), t);
          expect(sentence, action).not.toBe(action);
          expect(sentence, action).not.toMatch(/[{}]|undefined|NaN/);
        }
      }
    }
  });

  it('read the plan’s example: an office-issued code, a substitute, the alerts of a class', () => {
    const entry = row({
      action: 'student_alert.viewed',
      category: 'alerts',
      actor_type: 'substitute',
      actor_user_id: null,
      actor_label: null,
      issuer_label: 'Julie Bergeron',
      details: { alert_count: 2, issued_by_role: 'office' },
      flags: ['office_issued_code'],
    });
    const view = auditEntryView(entry, { t: tFr, locale: 'fr-CA', timeZone: 'America/Toronto' });
    expect(view).toMatchObject({
      when: '12 nov. 2026 à 7 h 52',
      actor: 'Personne suppléante',
      // The badge says the office issued it: the name alone, not the same fact twice.
      issuer: 'code émis par Julie Bergeron',
      sentence: 'Alertes de sécurité ou médicales consultées (2 alertes)',
      entity: '3e année – Mme Tremblay',
      flags: ['Code émis par le secrétariat'],
      officeIssued: true,
    });
    const viewEn = auditEntryView(entry, { t: tEn, locale: 'en-CA', timeZone: 'America/Toronto' });
    expect(viewEn).toMatchObject({
      actor: 'Substitute',
      issuer: 'code issued by Julie Bergeron',
      sentence: 'Safety or medical alerts viewed (2 alerts)',
      flags: ['Code issued by the office'],
    });
    expect(viewEn.when).toMatch(/^Nov 12, 2026 at 7:52/);
    expect(
      auditSentence(row({ action: 'student_alert.viewed', details: { alert_count: 1 } }), tFr),
    ).toBe('Alertes de sécurité ou médicales consultées (1 alerte)');
    // A class without alerts: its list was opened, nothing was read.
    expect(
      auditSentence(row({ action: 'student_alert.viewed', details: { alert_count: 0 } }), tFr),
    ).toBe('Liste des alertes ouverte (aucune alerte)');
    expect(
      auditSentence(row({ action: 'student_alert.viewed', details: { alert_count: 0 } }), tEn),
    ).toBe('Alert list opened (no alerts)');
    // The office's badge without the name: no issuer line at all.
    expect(
      auditEntryView(
        { ...entry, issuer_label: null },
        { t: tFr, locale: 'fr-CA', timeZone: 'America/Toronto' },
      ).issuer,
    ).toBeNull();
  });

  it('say who issued a code when only the role or only the name is known', () => {
    const sub = { action: 'sub_plan.viewed', actor_type: 'substitute' as const, actor_label: null };
    expect(auditIssuer(row({ ...sub, details: { issued_by_role: 'office' } }), tFr)).toBe(
      'code émis par le secrétariat',
    );
    expect(auditIssuer(row({ ...sub, issuer_label: 'Isabelle Tremblay' }), tFr)).toBe(
      'code émis par Isabelle Tremblay',
    );
    expect(auditIssuer(row({ ...sub, details: { issued_by_role: 'robot' } }), tFr)).toBeNull();
    // Staff entries have no issuer.
    expect(auditIssuer(row({ issuer_label: 'Julie Bergeron' }), tFr)).toBeNull();
  });

  it('name people the viewer may read, and only them', () => {
    expect(auditActor(row(), tFr)).toBe('Sophie Lavoie');
    expect(auditActor(row({ actor_label: null }), tFr)).toBe('Personne qui n’a plus accès');
    expect(auditActor(row({ actor_type: 'system', actor_label: null }), tFr)).toBe('Système');
    expect(auditActor(row({ actor_type: 'service', actor_label: null }), tFr)).toBe('IP Lynx');
    expect(
      auditSentence(
        row({
          action: 'class_teacher.added',
          subject_label: 'Paul Leblanc',
          details: { role: 'subject' },
        }),
        tFr,
      ),
    ).toBe('Ajout à l’équipe de la classe\u00a0: Paul Leblanc (Enseignant·e de matière)');
    expect(
      auditSentence(
        row({
          action: 'user_role.granted',
          entity_type: 'user',
          entity_label: 'Marc Gagnon',
          details: { role: 'teacher' },
        }),
        tFr,
      ),
    ).toBe('Rôle accordé\u00a0: Marc Gagnon (Enseignant·e)');
    expect(
      auditSentence(
        row({ action: 'staff.access_removed', entity_type: 'user', entity_label: null }),
        tFr,
      ),
    ).toBe('Accès retiré\u00a0: Personne qui n’a plus accès');
    expect(
      auditSentence(
        row({
          action: 'staff.invited',
          entity_type: 'staff_invitation',
          entity_label: null,
          details: { role: 'office_admin' },
        }),
        tFr,
      ),
    ).toBe('Invitation préparée\u00a0: Personne invitée (Secrétariat)');
    expect(
      auditSentence(
        row({
          action: 'class_teacher.role_changed',
          subject_label: 'Paul Leblanc',
          details: { from: 'subject', to: 'support' },
        }),
        tEn,
      ),
    ).toBe('Class team role changed: Paul Leblanc (Subject teacher → Support)');
  });

  it('show a student only by their class, never by name', () => {
    const alert = row({
      action: 'student_alert.created',
      entity_type: 'student',
      entity_label: '3e année – Mme Tremblay',
    });
    expect(auditEntity(alert, tFr)).toBe('Élève · 3e année – Mme Tremblay');
    expect(auditEntity({ ...alert, entity_label: null }, tFr)).toBe('Élève');
    expect(auditEntity(row({ entity_label: null }), tFr)).toBe('Classe');
    expect(auditEntity(row({ entity_type: 'user', entity_label: 'Marc Gagnon' }), tFr)).toBeNull();
    expect(
      auditEntity(row({ entity_type: 'user', entity_label: 'Marc Gagnon' }), tFr, { all: true }),
    ).toBe('Marc Gagnon');
    expect(auditEntity(row({ entity_type: 'thing', entity_label: null }), tFr)).toBe('Élément');
    expect(auditEntity(row({ entity_type: null, entity_id: null }), tFr)).toBeNull();
  });

  it('put codes into words', () => {
    expect(
      auditSentence(
        row({ action: 'school.module_changed', details: { module: 'library', enabled: true } }),
        tFr,
      ),
    ).toBe('Module Banque de ressources activé pour l’école');
    expect(
      auditSentence(
        row({ action: 'school.module_changed', details: { module: 'library', enabled: false } }),
        tEn,
      ),
    ).toBe('Resource library module turned off for the school');
    expect(
      auditSentence(row({ action: 'operator.access', details: { reason: 'incident' } }), tFr),
    ).toBe('Accès d’IP Lynx aux données du conseil (incident)');
    expect(
      auditSentence(row({ action: 'sub_plan.deleted', details: { reason: 'retention' } }), tFr),
    ).toBe('Plan de suppléance supprimé (conservation des données)');
    expect(
      auditSentence(row({ action: 'sub_plan.deleted', details: { reason: 'weird' } }), tFr),
    ).toBe('Plan de suppléance supprimé (autre raison)');
    expect(auditSentence(row({ action: 'audit_log.exported', details: { rows: 12 } }), tFr)).toBe(
      'Journal d’audit exporté (12 entrées)',
    );
    expect(
      auditSentence(row({ action: 'class.students_purged', details: { students: 20 } }), tEn),
    ).toBe('Student first names erased after the school year (20 students)');
  });

  it('fall back on the code for an action with no sentence (never shown by the database)', () => {
    expect(auditSentence(row({ action: 'library_item.generated' }), tFr)).toBe(
      'library_item.generated',
    );
  });

  it('give the time on the school’s clock', () => {
    // 12:52 UTC is 7:52 in Toronto in November (EST), 8:52 in October (EDT).
    expect(auditWhen(row(), 'fr-CA', 'America/Toronto', tFr)).toBe('12 nov. 2026 à 7 h 52');
    expect(
      auditWhen(row({ occurred_at: '2026-10-12T12:52:00Z' }), 'fr-CA', 'America/Toronto', tFr),
    ).toBe('12 oct. 2026 à 8 h 52');
  });

  it('list the details as key=value, sorted', () => {
    expect(auditDetailsText(row({ details: { role: 'office', all: true, codes: 2 } }))).toBe(
      'all=true; codes=2; role=office',
    );
    expect(auditDetailsText(row())).toBe('');
  });
});

describe('parseAuditRows', () => {
  it('reads what list_audit_entries returns', () => {
    const [parsed] = parseAuditRows([
      { ...row(), id: '7', flags: null, details: { role: 'teacher', nested: { a: 1 } } },
    ]);
    expect(parsed).toMatchObject({ id: 7, flags: [], details: {} });
    expect(parseAuditRows(null)).toEqual([]);
  });

  it('refuses a row it cannot read rather than leaving it out', () => {
    expect(() => parseAuditRows([{ ...row(), action: 'DROP TABLE' }])).toThrow();
  });
});
