import { Badge } from '@/components/ui/card';
import type { AuditEntryView } from '@/server/audit/labels';

/** An entry's flags, as text badges (« Code émis par le secrétariat », D-056). */
export function AuditFlags({ entry }: { entry: AuditEntryView }) {
  if (entry.flags.length === 0) return null;
  return (
    <>
      {entry.flags.map((flag) => (
        <Badge key={flag} tone="warning">
          {flag}
        </Badge>
      ))}
    </>
  );
}

/** Who acted, and for a substitute who issued the code. */
export function AuditWho({ entry }: { entry: AuditEntryView }) {
  return (
    <>
      <span className="font-medium text-slate-900">{entry.actor}</span>
      {entry.issuer ? <span className="block text-slate-600">{entry.issuer}</span> : null}
    </>
  );
}

/**
 * One entry in a short list (the direction's dashboard): the sentence, then when, who and what
 * it is about, and its flags. « Journal d'audit » itself uses cards and a table (AuditList).
 */
export function AuditEntrySummary({ entry }: { entry: AuditEntryView }) {
  return (
    <div className="space-y-1 text-sm" data-testid="audit-entry">
      <p className="font-medium text-slate-900">{entry.sentence}</p>
      <p className="text-slate-600">
        {[entry.when, entry.actor, entry.issuer, entry.entity].filter(Boolean).join(' · ')}
      </p>
      {entry.flags.length ? (
        <p className="flex flex-wrap gap-1.5">
          <AuditFlags entry={entry} />
        </p>
      ) : null}
    </div>
  );
}
