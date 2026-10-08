/**
 * How an entry of « Journal d'audit » reads (DECISIONS D-103), on the page, the direction's
 * dashboard and in the CSV: « 12 nov. 2026 à 7 h 52 · Personne suppléante · code émis par Julie
 * Bergeron (secrétariat) · Alertes de sécurité ou médicales consultées (2 alertes) · 3e année –
 * Mme Tremblay ». The sentence is `audit.actions.<action>` (one per action of the catalogue that
 * someone may read; catalog.test.ts checks them all). Only the labels the database already
 * checked for the viewer are used: a missing label reads « Personne qui n'a plus accès », a
 * student only as « Élève · <classe> ». Pure (no server-only import): unit tested with the real
 * message files.
 */
import { DEFAULT_OPERATOR_NAME } from '@lynx/config';
import { formatLocalDate, formatTime, instantInZone } from '../../lib/format';
import type { AuditActorType, AuditRow } from './rows';

/**
 * next-intl's translator seen as one that takes any key: the audit's keys are built from action
 * codes and detail values, and every one is checked with `has` before use.
 */
export interface AuditT {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

export const asAuditT = (translator: unknown) => translator as AuditT;

export const auditActionKey = (action: string) => `audit.actions.${action}`;

type Details = AuditRow['details'];

const text = (details: Details, key: string): string | null => {
  const value = details[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

const count = (details: Details, ...keys: string[]): number => {
  for (const key of keys) {
    const value = Number(details[key]);
    if (details[key] !== null && details[key] !== undefined && Number.isFinite(value)) return value;
  }
  return 0;
};

/** A role from an entry's details: a staff role, a class-team role, else a dash. */
function roleLabel(role: string | null, t: AuditT): string {
  if (!role) return '—';
  if (t.has(`profile.roleNames.${role}`)) return t(`profile.roleNames.${role}`);
  if (t.has(`classes.role.${role}`)) return t(`classes.role.${role}`);
  return '—';
}

/** The person an entry is about: the added teacher, the person whose role changed… */
function personLabel(entry: AuditRow, t: AuditT): string {
  const own =
    entry.entity_type === 'user' || entry.entity_type === 'staff_invitation'
      ? entry.entity_label
      : null;
  return (
    entry.subject_label ??
    own ??
    t(entry.entity_type === 'staff_invitation' ? 'audit.invitedPerson' : 'audit.formerPerson')
  );
}

/** The values every action's sentence may use. */
function sentenceValues(entry: AuditRow, t: AuditT): Record<string, string | number> {
  const details = entry.details;
  const reason = text(details, 'reason');
  const moduleKey = text(details, 'module');
  return {
    person: personLabel(entry, t),
    role: roleLabel(text(details, 'role'), t),
    fromRole: roleLabel(text(details, 'from'), t),
    toRole: roleLabel(text(details, 'to'), t),
    alertCount: count(details, 'alert_count'),
    count: count(details, 'rows', 'students', 'count'),
    reason:
      reason && t.has(`audit.values.reasons.${reason}`)
        ? t(`audit.values.reasons.${reason}`)
        : t('audit.values.reasons.other'),
    module:
      moduleKey && t.has(`board.schools.moduleNames.${moduleKey}`)
        ? t(`board.schools.moduleNames.${moduleKey}`)
        : (moduleKey ?? '—'),
    state: t(details.enabled === true ? 'audit.values.enabled' : 'audit.values.disabled'),
  };
}

/** What happened, e.g. « Rôle accordé : Marc Gagnon (Enseignant·e) ». */
export function auditSentence(entry: AuditRow, t: AuditT): string {
  const key = auditActionKey(entry.action);
  // Every action the viewer's function returns has a sentence (catalog.test.ts); the code is a
  // last resort, never an empty cell.
  return t.has(key) ? t(key, sentenceValues(entry, t)) : entry.action;
}

/** « Personnel », « Personne suppléante », « Système », « Gestionnaire du serveur ». */
export const actorTypeLabel = (type: AuditActorType, t: AuditT) => t(`audit.actorTypes.${type}`);

/**
 * Who did it: a staff member's name; for the operator (the admin CLI), the name its
 * `OPERATOR_NAME` recorded, « IP Lynx » for entries written before it was (DECISIONS D-147); else
 * what acted (a substitute, the system).
 */
export function auditActor(entry: AuditRow, t: AuditT): string {
  if (entry.actor_type === 'service') return entry.actor_label ?? DEFAULT_OPERATOR_NAME;
  if (entry.actor_type !== 'user') return actorTypeLabel(entry.actor_type, t);
  return entry.actor_label ?? t('audit.formerPerson');
}

/**
 * For a substitute's entry, who issued the code and from where (D-056): the issuer's name when
 * the viewer may read it, and the issuer's role (`issued_by_role`: owner, direction, office).
 */
export function auditIssuerParts(
  entry: AuditRow,
  t: AuditT,
): { name: string | null; role: string | null } | null {
  if (entry.actor_type !== 'substitute') return null;
  const role = text(entry.details, 'issued_by_role');
  const known = role !== null && t.has(`audit.issuerRoles.${role}`) ? role : null;
  if (!entry.issuer_label && !known) return null;
  return { name: entry.issuer_label, role: known };
}

/**
 * « code émis par Julie Bergeron (secrétariat) », « code émis par le secrétariat ». When the
 * office issued it, its badge (« Code émis par le secrétariat ») says so already: the name alone,
 * or nothing when the name is not shown.
 */
export function auditIssuer(entry: AuditRow, t: AuditT): string | null {
  const parts = auditIssuerParts(entry, t);
  if (!parts) return null;
  if (entry.flags.includes('office_issued_code')) {
    return parts.name ? t('audit.issuedByName', { name: parts.name }) : null;
  }
  if (parts.name && parts.role) {
    return t('audit.issuedBy', { name: parts.name, role: t(`audit.issuerRoles.${parts.role}`) });
  }
  if (parts.name) return t('audit.issuedByName', { name: parts.name });
  return t('audit.issuedByRole', { role: t(`audit.issuerRolesAlone.${parts.role!}`) });
}

/** The kind of item an entry is about (« Classe », « Plan de suppléance »…). */
export function entityTypeLabel(type: string | null, t: AuditT): string {
  if (!type) return '';
  return t.has(`audit.entities.types.${type}`)
    ? t(`audit.entities.types.${type}`)
    : t('audit.entities.types.other');
}

/**
 * The item an entry is about, as the viewer may read it: a class, a plan (« 2026-11-12 · Mme
 * Tremblay »), a resource's title; a student only as « Élève · 3e année – Mme Tremblay ». Its
 * kind when the label is hidden. With `all: false` (the screen), people and invitations are left
 * out: the sentence already names them.
 */
export function auditEntity(entry: AuditRow, t: AuditT, { all = false } = {}): string | null {
  const type = entry.entity_type;
  if (!type) return null;
  if (!all && (type === 'user' || type === 'staff_invitation' || type === 'audit_log')) return null;
  if (type === 'student') {
    return entry.entity_label
      ? t('audit.entities.student', { className: entry.entity_label })
      : entityTypeLabel(type, t);
  }
  return entry.entity_label ?? (entry.entity_id ? entityTypeLabel(type, t) : null);
}

/** The entry's flags in words (« Code émis par le secrétariat »). */
export function auditFlags(entry: AuditRow, t: AuditT): string[] {
  return entry.flags.flatMap((flag) =>
    flag === 'office_issued_code' ? [t('audit.flags.officeIssuedCode')] : [],
  );
}

/** « 12 nov. 2026 à 7 h 52 », on the school's (or board's) clock. */
export function auditWhen(entry: AuditRow, locale: string, timeZone: string, t: AuditT): string {
  const at = instantInZone(entry.occurred_at, timeZone);
  return t('audit.when', {
    date: formatLocalDate(at.date, locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    time: formatTime(at.time, locale),
  });
}

/** The whitelisted details as `key=value; …` (sorted), for the CSV. */
export function auditDetailsText(entry: AuditRow): string {
  return Object.keys(entry.details)
    .sort()
    .flatMap((key) => {
      const value = entry.details[key];
      return value === null || value === undefined ? [] : [`${key}=${String(value)}`];
    })
    .join('; ');
}

/** What a page shows of one entry. */
export interface AuditEntryView {
  id: number;
  occurredAt: string;
  when: string;
  actor: string;
  actorType: AuditActorType;
  issuer: string | null;
  sentence: string;
  entity: string | null;
  /** For « Historique de cet élément » (« … de cette personne » for a person). */
  entityId: string | null;
  entityType: string | null;
  schoolName: string | null;
  flags: string[];
  officeIssued: boolean;
}

export function auditEntryView(
  entry: AuditRow,
  { t, locale, timeZone }: { t: AuditT; locale: string; timeZone: string },
): AuditEntryView {
  return {
    id: entry.id,
    occurredAt: entry.occurred_at,
    when: auditWhen(entry, locale, timeZone, t),
    actor: auditActor(entry, t),
    actorType: entry.actor_type,
    issuer: auditIssuer(entry, t),
    sentence: auditSentence(entry, t),
    entity: auditEntity(entry, t),
    entityId: entry.entity_id,
    entityType: entry.entity_type,
    schoolName: entry.school_name,
    flags: auditFlags(entry, t),
    officeIssued: entry.flags.includes('office_issued_code'),
  };
}
