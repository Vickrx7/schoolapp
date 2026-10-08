/**
 * « Télécharger (CSV) » of « Journal d'audit » (DECISIONS D-103): one line per entry, newest
 * first, with the labels the viewer may read and nothing else. The file format is the shared one
 * (`server/csv.ts`: a byte order mark, `;` in French and `,` in English, a `'` before a cell that
 * starts like a formula). Columns: the time on the school's clock, the action's code and its
 * sentence, who acted (a person, or the operator's recorded name, D-147) and as what, who issued
 * the code, the person concerned, the school, the item's kind and label, the whitelisted details
 * (`key=value; …`) and the flags. Pure: unit tested.
 */
import { instantInZone } from '../../lib/format';
import { csvDocument } from '../csv';
import {
  actorTypeLabel,
  auditActor,
  auditDetailsText,
  auditEntity,
  auditFlags,
  auditIssuerParts,
  auditSentence,
  entityTypeLabel,
  type AuditT,
} from './labels';
import type { AuditRow } from './rows';

export function auditCsv(
  rows: readonly AuditRow[],
  { locale, timeZone, t }: { locale: string; timeZone: string; t: AuditT },
): string {
  const header = [
    'when',
    'action',
    'actionLabel',
    'actor',
    'actorType',
    'issuer',
    'subject',
    'school',
    'entityType',
    'entity',
    'details',
    'flags',
  ].map((column) => t(`audit.csv.${column}`));
  return csvDocument(
    [
      header,
      ...rows.map((row) => {
        const at = instantInZone(row.occurred_at, timeZone);
        const issuer = auditIssuerParts(row, t);
        const issuerRole = issuer?.role ? t(`audit.issuerRoles.${issuer.role}`) : null;
        return [
          `${at.date} ${at.time}`,
          row.action,
          auditSentence(row, t),
          row.actor_type === 'user' || row.actor_type === 'service' ? auditActor(row, t) : '',
          actorTypeLabel(row.actor_type, t),
          issuer
            ? issuer.name
              ? `${issuer.name}${issuerRole ? ` (${issuerRole})` : ''}`
              : issuerRole
            : '',
          row.subject_label,
          row.school_name,
          entityTypeLabel(row.entity_type, t),
          auditEntity(row, t, { all: true }),
          auditDetailsText(row),
          auditFlags(row, t).join(' · '),
        ];
      }),
    ],
    locale,
  );
}
