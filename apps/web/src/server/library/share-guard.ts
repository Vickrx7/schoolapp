/**
 * The first-name guard (DECISIONS D-066): before a resource is shared, proposed to the board, or
 * saved while shared, its every string (details, every version's content and key) is checked for
 * students' first names and for personal details, with the AI privacy tools. A student's name is
 * listed and the teacher may confirm each one as « Ce n'est pas un nom d'élève » (saint Thomas,
 * Samuel de Champlain); e-mail addresses, phone numbers and other personal details always block.
 * Staff names are allowed. The guard catches accidents only: the database cannot run it.
 *
 * Pure (the students come from the caller), so it is unit-tested.
 */
import { Redactor, findBlockedDetails, type BlockedKind, type KnownPerson } from '@lynx/ai/privacy';
import { MACHINE_KEYS } from '@lynx/content';

export interface PersonalInfoFindings {
  /** Students' first names found, as the roster spells them, in the order found. */
  studentNames: string[];
  /** Kinds of personal detail found (each once). */
  blocked: BlockedKind[];
}

/** Every prose string of a JSON value (ids, kinds and other machine values are left out). */
export function proseStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) proseStrings(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, v] of Object.entries(value)) {
      if (!MACHINE_KEYS.has(key)) proseStrings(v, out);
    }
  }
  return out;
}

export interface GuardedItem {
  title: string;
  summary: string | null;
  materials: string | null;
  keywords: string | null;
  catholicConnection: string | null;
  safetyNotes: unknown;
  versions: readonly { content: unknown; answerKey: unknown }[];
}

/** The strings of an item the guard reads: its details, then each version's content and key. */
export function itemStrings(item: GuardedItem): string[] {
  const out: string[] = [];
  for (const text of [
    item.title,
    item.summary,
    item.materials,
    item.keywords,
    item.catholicConnection,
  ]) {
    if (text?.trim()) out.push(text);
  }
  proseStrings(item.safetyNotes, out);
  for (const version of item.versions) {
    proseStrings(version.content, out);
    proseStrings(version.answerKey, out);
  }
  return out;
}

/**
 * Students' first names and personal details in `strings`. Only `kind: 'student'` people are
 * looked for: staff names may appear in shared resources. A name that is also an everyday word
 * (Rose, Pierre) counts only when capitalized, as the AI preview does.
 */
export function findPersonalInfo(
  strings: readonly string[],
  people: readonly KnownPerson[],
): PersonalInfoFindings {
  const redactor = new Redactor(people.filter((p) => p.kind === 'student'));
  const blocked = new Set<BlockedKind>();
  for (const text of strings) {
    redactor.redact(text);
    for (const finding of findBlockedDetails(text)) blocked.add(finding.kind);
  }
  const studentNames: string[] = [];
  for (const r of redactor.replacements()) {
    if (r.kind === 'student' && !studentNames.includes(r.original)) studentNames.push(r.original);
  }
  return { studentNames, blocked: [...blocked] };
}

const fold = (name: string) =>
  name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-CA').trim();

/** The names found that the teacher has not confirmed as « Ce n'est pas un nom d'élève ». */
export function unconfirmedNames(found: readonly string[], confirmed: readonly string[]): string[] {
  const ok = new Set(confirmed.map(fold));
  return found.filter((name) => !ok.has(fold(name)));
}

/** What the guard answers: go ahead (with how many names were confirmed), or what to fix. */
export type GuardVerdict =
  { ok: true; namesConfirmed: number } | { ok: false; names: string[]; blocked: BlockedKind[] };

export function guardVerdict(
  findings: PersonalInfoFindings,
  confirmed: readonly string[],
): GuardVerdict {
  const missing = unconfirmedNames(findings.studentNames, confirmed);
  if (findings.blocked.length || missing.length) {
    return { ok: false, names: findings.studentNames, blocked: findings.blocked };
  }
  return { ok: true, namesConfirmed: findings.studentNames.length };
}
