/**
 * A content pack as SQL (DECISIONS P-11): one `DO` block that resolves every reference by code
 * and raises on anything missing, then inserts the pack, its tags and its items with UUIDv5
 * ids. Pure and deterministic: the same pack gives the same text, so CI can check the
 * generated seed for drift. The columns follow the Phase 4 library migration (C1): workflow
 * state is written directly (the seed runs as the database owner), and `requires_faith_review`
 * is left to the items trigger.
 */
import { questionSchemas, type AnswerKey } from './questions';
import { contentObject } from './schemas';
import { conform } from './conform';
import { seedItemSchema, seedPackSchema, type SeedItem, type SeedPack } from './seed-pack';
import { LYNX_CONTENT_NAMESPACE, uuidv5 } from './uuid';

/** Dollar-quote tag of every prose and JSON literal; no content may contain it. */
export const PACK_QUOTE = '$lynxpack$';
const BLOCK_QUOTE = '$lynxseed$';

export const seedItemId = (packSlug: string, itemSlug: string) =>
  uuidv5(`${packSlug}/${itemSlug}`, LYNX_CONTENT_NAMESPACE);
export const seedVersionId = (packSlug: string, itemSlug: string, level: string | null) =>
  uuidv5(`${packSlug}/${itemSlug}/${level ?? 'base'}`, LYNX_CONTENT_NAMESPACE);
export const seedPackId = (packSlug: string, version: string) =>
  uuidv5(`pack/${packSlug}/${version}`, LYNX_CONTENT_NAMESPACE);
export const seedTagId = (tagSlug: string) => uuidv5(`tag/${tagSlug}`, LYNX_CONTENT_NAMESPACE);

/** A machine string (slug, code, e-mail) as a standard SQL literal. */
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
/** Prose or JSON, dollar-quoted. */
const dq = (value: string) => `${PACK_QUOTE}${value}${PACK_QUOTE}`;
const dqOrNull = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === '' ? 'null' : dq(value);
const json = (value: unknown) => `${dq(JSON.stringify(value))}::jsonb`;

type RefKind = 'user' | 'school' | 'subject' | 'expectation' | 'level' | 'reference' | 'tag';

interface Ref {
  kind: RefKind;
  key: string;
  variable: string;
  lookup: string;
}

/** Collects the references of the pack, each once, in order of first use. */
class Refs {
  private readonly byKey = new Map<string, Ref>();
  private readonly counts = new Map<RefKind, number>();

  get all(): Ref[] {
    return [...this.byKey.values()];
  }

  private add(kind: RefKind, key: string, prefix: string, lookup: (v: string) => string): string {
    const id = `${kind}:${key}`;
    const existing = this.byKey.get(id);
    if (existing) return existing.variable;
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    const variable = `${prefix}${n}`;
    this.byKey.set(id, { kind, key, variable, lookup: lookup(variable) });
    return variable;
  }

  user(email: string) {
    return this.add(
      'user',
      email,
      'r_user_',
      (v) => `select id into ${v} from public.users where email = ${q(email)};`,
    );
  }
  school(slug: string) {
    return this.add(
      'school',
      slug,
      'r_school_',
      (v) =>
        `select id into ${v} from public.schools where board_id = v_board and slug = ${q(slug)};`,
    );
  }
  subject(code: string) {
    return this.add(
      'subject',
      code,
      'r_subject_',
      (v) =>
        `select id into ${v} from public.subjects where code = ${q(code)} and board_id is null;`,
    );
  }
  expectation(subjectCode: string, grade: string, code: string) {
    const subject = this.subject(subjectCode);
    return this.add(
      'expectation',
      `${subjectCode} ${grade} ${code}`,
      'r_exp_',
      (v) =>
        `select id into ${v} from public.curriculum_expectations where subject_id = ${subject} ` +
        `and grade_code = ${q(grade)} and code = ${q(code)} order by curriculum_version desc limit 1;`,
    );
  }
  level(code: string) {
    return this.add(
      'level',
      code,
      'r_level_',
      (v) =>
        `select id into ${v} from public.language_levels where board_id = v_board ` +
        `and owner_user_id is null and code = ${q(code)};`,
    );
  }
  reference(title: string) {
    return this.add(
      'reference',
      title,
      'r_ref_',
      (v) =>
        `select id into ${v} from public.catholic_references where title = ${dq(title)} ` +
        'and active and (board_id = v_board or board_id is null) order by board_id nulls last limit 1;',
    );
  }
  tag(slug: string) {
    return this.add(
      'tag',
      slug,
      'r_tag_',
      (v) => `select id into ${v} from public.tags where board_id is null and slug = ${q(slug)};`,
    );
  }
}

/** Canonical key order (schema order), so reformatting an item file doesn't change the SQL. */
function canonical(item: SeedItem) {
  return item.versions.map((v) => ({
    level: v.level,
    content: conform(contentObject(item.type, 'draft'), v.content),
    answerKey: v.answerKey
      ? (conform(questionSchemas('draft').answerKey, v.answerKey) as AnswerKey)
      : null,
  }));
}

function itemSql(pack: SeedPack, item: SeedItem, index: number, refs: Refs): string[] {
  const id = q(seedItemId(pack.slug, item.slug));
  const author = item.author ? refs.user(item.author) : 'null';
  const approver = item.approvedBy ? refs.user(item.approvedBy) : 'null';
  const school = item.school ? refs.school(item.school) : 'null';
  const subject = refs.subject(item.subjectCode);
  const reference = item.catholicReference ? refs.reference(item.catholicReference) : 'null';
  const approved = item.status === 'board_approved';
  const lines = [
    `  -- ${index + 1}. ${pack.slug}/${item.slug} (${item.type})`,
    '  insert into public.library_items (id, board_id, school_id, type, title, summary, status,',
    '    share_scope, source, author_id, licence, content_pack_id, subject_id, duration_minutes,',
    '    materials, keywords, is_printable, is_projectable, is_interactive, sub_friendly,',
    '    safety_notes, faith_content, faith_on_student_sheet, catholic_connection,',
    '    catholic_reference_id, prompt_version, model, review_requested_at, review_requested_by,',
    '    approved_at, approved_by, faith_reviewed_at, faith_reviewed_by)',
    `  values (${id}, v_board, ${school}, ${q(item.type)}, ${dq(item.title)}, ${dqOrNull(item.summary)},`,
    `    ${q(item.status)}, ${q(item.shareScope)}, ${q(item.source)}, ${author}, ${dqOrNull(item.licence)},`,
    `    v_pack, ${subject}, ${item.durationMinutes}, ${dq(item.materials)}, ${dqOrNull(item.keywords)},`,
    `    ${item.formats.printable}, ${item.formats.projectable}, ${item.formats.interactive}, ${item.subFriendly},`,
    `    ${item.safetyNotes ? json(item.safetyNotes) : 'null'}, ${item.faithContent}, ${item.faithOnStudentSheet},`,
    `    ${dqOrNull(item.catholicConnection)}, ${reference}, ${dqOrNull(item.promptVersion)}, ${dqOrNull(item.model)},`,
    `    ${item.reviewRequested ? `now(), ${author}` : 'null, null'},`,
    `    ${approved ? `now(), ${approver}` : 'null, null'},`,
    `    ${item.faithReviewed ? `now(), ${approver}` : 'null, null'});`,
    `  insert into public.library_item_grades (item_id, grade_code) values`,
    `    ${item.gradeCodes.map((g) => `(${id}, ${q(g)})`).join(', ')};`,
  ];
  if (item.expectations.length) {
    const values = item.expectations.map(
      (e) => `(${id}, ${refs.expectation(item.subjectCode, e.grade, e.code)})`,
    );
    lines.push(
      '  insert into public.library_item_expectations (item_id, expectation_id) values',
      `    ${values.join(', ')};`,
    );
  }
  if (item.tags.length) {
    lines.push(
      '  insert into public.library_item_tags (item_id, tag_id) values',
      `    ${item.tags.map((t) => `(${id}, ${refs.tag(t)})`).join(', ')};`,
    );
  }
  const versions = canonical(item);
  lines.push(
    '  insert into public.library_item_versions (id, item_id, language_level_id, schema_version, content) values',
    versions
      .map((v) => {
        const level = v.level ? refs.level(v.level) : 'null';
        return `    (${q(seedVersionId(pack.slug, item.slug, v.level))}, ${id}, ${level}, 1, ${json(v.content)})`;
      })
      .join(',\n') + ';',
  );
  const keyed = versions.filter((v) => v.answerKey);
  if (keyed.length) {
    lines.push(
      '  insert into public.library_item_answer_keys (version_id, answer_key) values',
      keyed
        .map(
          (v) => `    (${q(seedVersionId(pack.slug, item.slug, v.level))}, ${json(v.answerKey)})`,
        )
        .join(',\n') + ';',
    );
  }
  lines.push(`  perform app.library_refresh_search(${id});`);
  return lines;
}

/**
 * The seed SQL of a pack. Throws when the pack or an item is invalid, when the pack's item
 * list and the items differ, when an item uses a tag the pack doesn't define, or when any text
 * contains a quote tag.
 */
export function packToSql(packInput: unknown, itemInputs: readonly unknown[]): string {
  const pack = seedPackSchema.parse(packInput);
  const items = itemInputs.map((raw, i) => {
    const parsed = seedItemSchema.safeParse(raw);
    if (!parsed.success) {
      const slug = (raw as { slug?: unknown } | null)?.slug;
      const first = parsed.error.issues[0]!;
      throw new Error(
        `invalid item ${String(slug ?? i)} at ${first.path.join('.')}: ${first.message}`,
      );
    }
    return parsed.data;
  });

  const bySlug = new Map(items.map((item) => [item.slug, item]));
  if (bySlug.size !== items.length) throw new Error('duplicate item slug');
  const missing = pack.items.filter((s) => !bySlug.has(s));
  const extra = items.filter((item) => !pack.items.includes(item.slug)).map((i) => i.slug);
  if (missing.length || extra.length) {
    throw new Error(
      `pack items and item files differ: missing ${missing.join(', ') || '—'}; extra ${extra.join(', ') || '—'}`,
    );
  }
  const tagSlugs = new Set(pack.tags.map((t) => t.slug));
  for (const item of items) {
    for (const tag of item.tags) {
      if (!tagSlugs.has(tag)) throw new Error(`item ${item.slug} uses unknown tag ${tag}`);
    }
  }
  const everything = JSON.stringify([pack, items]);
  for (const tag of [PACK_QUOTE, BLOCK_QUOTE]) {
    if (everything.includes(tag)) throw new Error(`the pack contains the quote tag ${tag}`);
  }

  const refs = new Refs();
  const body: string[] = [];
  pack.items.forEach((slug, i) => {
    body.push(...itemSql(pack, bySlug.get(slug)!, i, refs), '');
  });

  const all = refs.all;
  const declarations = all.map((r) => `  ${r.variable} uuid; -- ${r.kind} ${r.key}`);
  const lookup = (r: Ref) => [
    `  ${r.lookup}`,
    `  if ${r.variable} is null then raise exception 'library seed: % not found: %', ${q(r.kind)}, ${q(r.key)}; end if;`,
  ];
  const tagRows = pack.tags.map(
    (t) => `    (${q(seedTagId(t.slug))}, null, ${q(t.slug)}, ${dq(t.labelFr)})`,
  );
  const manifest = { items: pack.items, generator: 'packToSql' };
  // Tags are looked up after the pack inserts them (an existing global tag of the same slug
  // is kept and used).
  const otherLookups = all.filter((r) => r.kind !== 'tag').flatMap(lookup);
  const tagLookups = all.filter((r) => r.kind === 'tag').flatMap(lookup);

  return [
    `-- Generated by \`pnpm library:seed\` from content/library/${pack.slug}. Do not edit by hand.`,
    `-- Pack ${pack.slug} ${pack.version}: ${items.length} items.`,
    `do ${BLOCK_QUOTE}`,
    'declare',
    '  v_board uuid;',
    `  v_pack uuid := ${q(seedPackId(pack.slug, pack.version))};`,
    ...declarations,
    'begin',
    `  select id into v_board from public.boards where slug = ${q(pack.board)};`,
    `  if v_board is null then raise exception 'library seed: board % not found', ${q(pack.board)}; end if;`,
    '  if exists (select 1 from public.content_packs where id = v_pack) then',
    `    raise notice 'library seed: pack % % is already loaded', ${q(pack.slug)}, ${q(pack.version)};`,
    '    return;',
    '  end if;',
    ...otherLookups,
    '',
    '  insert into public.content_packs (id, board_id, slug, version, title, publisher, manifest)',
    `  values (v_pack, v_board, ${q(pack.slug)}, ${q(pack.version)}, ${dq(pack.title)}, ${dqOrNull(pack.publisher)},`,
    `    ${json(manifest)});`,
    ...(tagRows.length
      ? [
          '  insert into public.tags (id, board_id, slug, label_fr) values',
          `${tagRows.join(',\n')}`,
          '  on conflict do nothing;',
        ]
      : []),
    ...tagLookups,
    '',
    ...body,
    `end ${BLOCK_QUOTE};`,
    '',
  ].join('\n');
}
