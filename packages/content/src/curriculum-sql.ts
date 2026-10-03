/**
 * The curriculum sample as SQL (DECISIONS D-030, D-070, D-071): the import files of
 * `content/curriculum` (`curriculumFileSchema`) become one `DO` block,
 * `supabase/seeds/10_curriculum_demo.sql`. The demo database loads it after `supabase/seed.sql`
 * and before the demo library (`20_library_demo.sql`), whose items link to these attentes by code.
 *
 * - Every file is parsed without `confirmLicence`, so official or verified text is refused:
 *   every row is a paraphrase with `is_verified = false` (« À vérifier » in the app).
 * - Strands and attentes are matched by code, like `pnpm admin import-curriculum`, and sort in
 *   file order within their grade. A new row gets a UUIDv5 id. A row the database already has
 *   (the attentes of `seed.sql`, which lessons and tests use by id) keeps its id, wording,
 *   strand, parent and verification: only its sort order follows the file, so the new contenus
 *   sort in place around it.
 * - The block raises when a subject, grade, strand or overall attente is missing, or when an
 *   existing attente has another kind, strand or parent than its file.
 *
 * Pure and deterministic: the same files give the same text, so CI can check the generated seed
 * for drift. Loading it again changes nothing.
 */
import { parseCurriculumFile, type CurriculumFile } from './curriculum-import';
import { LYNX_CONTENT_NAMESPACE, uuidv5 } from './uuid';

/** Dollar-quote tag of every prose literal; no text may contain it. */
export const CURRICULUM_QUOTE = '$lynxcurr$';
const BLOCK_QUOTE = '$lynxseed$';

export const curriculumStrandId = (subjectCode: string, version: string, code: string) =>
  uuidv5(`curriculum/${subjectCode}/${version}/strand/${code}`, LYNX_CONTENT_NAMESPACE);
export const curriculumExpectationId = (
  subjectCode: string,
  version: string,
  grade: string,
  code: string,
) => uuidv5(`curriculum/${subjectCode}/${version}/${grade}/${code}`, LYNX_CONTENT_NAMESPACE);

/** One curriculum file: its name (for messages and comments) and its JSON text or value. */
export interface CurriculumSource {
  name: string;
  json: unknown;
}

/** A machine string (code, id) as a standard SQL literal. */
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
/** Prose, dollar-quoted. */
const dq = (value: string) => `${CURRICULUM_QUOTE}${value}${CURRICULUM_QUOTE}`;
const dqOrNull = (value: string | null) =>
  value === null || value.trim() === '' ? 'null' : dq(value);
const qOrNull = (value: string | null) => (value === null ? 'null' : q(value));

interface Parsed {
  name: string;
  file: CurriculumFile;
}

/** Validates the files together; throws on the first problem, naming the file. */
function parseAll(sources: readonly CurriculumSource[]): Parsed[] {
  const parsed = [...sources]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, json }): Parsed => {
      const result = parseCurriculumFile(json);
      if (!result.data) {
        const shown = result.errors
          .slice(0, 5)
          .map((e) => `${e.path || '(file)'}: ${e.message}`)
          .join('; ');
        throw new Error(`${name}: ${shown}`);
      }
      return { name, file: result.data };
    });
  if (!parsed.length) throw new Error('no curriculum file');

  const strandsOf = new Map<string, { name: string; strands: string }>();
  const grades = new Map<string, string>();
  const codes = new Set<string>();
  for (const { name, file } of parsed) {
    const everything = JSON.stringify(file);
    for (const tag of [CURRICULUM_QUOTE, BLOCK_QUOTE]) {
      if (everything.includes(tag)) throw new Error(`${name}: contains the quote tag ${tag}`);
    }

    // Every file of a subject's version lists the same strands (they are shared by the grades).
    const version = `${file.subjectCode} ${file.curriculumVersion}`;
    const strands = JSON.stringify(file.strands);
    const other = strandsOf.get(version);
    if (other && other.strands !== strands) {
      throw new Error(`${name}: other strands than ${other.name} for ${version}`);
    }
    strandsOf.set(version, { name, strands });

    const byCode = new Map(file.expectations.map((e) => [`${e.grade} ${e.code}`, e]));
    for (const e of file.expectations) {
      // One file per subject, version and grade, so sort orders never collide.
      const grade = `${version} ${e.grade}`;
      const owner = grades.get(grade);
      if (owner !== undefined && owner !== name) {
        throw new Error(`${name}: ${owner} already has ${grade}`);
      }
      grades.set(grade, name);
      const key = `${version} ${e.grade} ${e.code}`;
      if (codes.has(key)) throw new Error(`${name}: ${key} appears twice`);
      codes.add(key);
      // A contenu is in its attente's strand (the import command checks the same).
      const parent = e.parentCode === null ? null : byCode.get(`${e.grade} ${e.parentCode}`);
      if (parent && parent.strandCode !== e.strandCode) {
        throw new Error(`${name}: ${e.grade} ${e.code} is not in the strand of ${e.parentCode}`);
      }
    }
  }
  return parsed;
}

/** The statement writing the strands of one subject's version, then its row-count check. */
function strandsSql({ name, file }: Parsed): string[] {
  const { subjectCode: subject, curriculumVersion: version } = file;
  const rows = file.strands.map(
    (s, i) =>
      `    (${q(curriculumStrandId(subject, version, s.code))}, ${q(s.code)}, ${dq(s.labelFr)}, ` +
      `${dqOrNull(s.labelEn)}, ${i + 1})`,
  );
  return [
    `  -- ${subject} ${version}: ${file.strands.length} strands (from ${name})`,
    '  insert into public.strands (id, subject_id, code, label_fr, label_en, curriculum_version,',
    '    sort_order)',
    `  select v.id::uuid, s.id, v.code, v.label_fr, v.label_en, ${q(version)}, v.sort_order`,
    '  from (values',
    rows.join(',\n'),
    '  ) as v (id, code, label_fr, label_en, sort_order)',
    `  join public.subjects s on s.code = ${q(subject)} and s.board_id is null`,
    '  on conflict (subject_id, curriculum_version, code) do update',
    '    set sort_order = excluded.sort_order;',
    '  get diagnostics v_count = row_count;',
    `  if v_count <> ${file.strands.length} then`,
    `    raise exception 'curriculum seed: % of % strands of % written (is the standard subject missing?)',`,
    `      v_count, ${file.strands.length}, ${q(`${subject} ${version}`)};`,
    '  end if;',
  ];
}

const CONFLICT = [
  '  on conflict (subject_id, grade_code, curriculum_version, code) do update',
  '    set sort_order = excluded.sort_order',
  '    where curriculum_expectations.kind = excluded.kind',
  '      and curriculum_expectations.strand_id is not distinct from excluded.strand_id',
  '      and curriculum_expectations.parent_id is not distinct from excluded.parent_id;',
];

/** The statements writing one file's overall attentes, then its contenus, with their checks. */
function expectationsSql({ name, file }: Parsed): string[] {
  const { subjectCode: subject, curriculumVersion: version } = file;
  // Sort orders follow the file within each grade, as with the import command.
  const positions = new Map<string, number>();
  const rows = file.expectations.map((e) => {
    const position = (positions.get(e.grade) ?? 0) + 1;
    positions.set(e.grade, position);
    return { ...e, position, id: curriculumExpectationId(subject, version, e.grade, e.code) };
  });

  const statement = (kind: 'overall' | 'specific') => {
    const picked = rows.filter((e) => e.kind === kind);
    if (!picked.length) return [];
    const specific = kind === 'specific';
    const values = picked.map(
      (e) =>
        `    (${q(e.id)}, ${q(e.grade)}, ${qOrNull(e.strandCode)}, ` +
        `${specific ? `${q(e.parentCode!)}, ` : ''}${q(e.code)}, ${dq(e.textFr)}, ` +
        `${dqOrNull(e.textEn)}, ${e.position})`,
    );
    const what = specific ? 'contenus (specific attentes)' : 'overall attentes';
    return [
      `  -- ${name}: ${picked.length} ${what}`,
      '  insert into public.curriculum_expectations (id, subject_id, grade_code, strand_id, parent_id,',
      '    kind, code, text_fr, text_en, curriculum_version, is_verified, source_note, sort_order)',
      `  select v.id::uuid, s.id, g.code, st.id, ${specific ? 'p.id' : 'null::uuid'},`,
      `    ${q(kind)}::public.expectation_kind, v.code, v.text_fr,`,
      `    v.text_en, ${q(version)}, false, ${dqOrNull(file.sourceNote)}, v.sort_order`,
      '  from (values',
      values.join(',\n'),
      `  ) as v (id, grade_code, strand_code, ${specific ? 'parent_code, ' : ''}code, text_fr, text_en, sort_order)`,
      `  join public.subjects s on s.code = ${q(subject)} and s.board_id is null`,
      '  join public.grades g on g.code = v.grade_code and g.ordinal between s.grade_min and s.grade_max',
      ...(specific
        ? [
            '  join public.curriculum_expectations p on p.subject_id = s.id and p.grade_code = g.code',
            `    and p.curriculum_version = ${q(version)} and p.code = v.parent_code and p.kind = 'overall'`,
          ]
        : []),
      '  left join public.strands st on st.subject_id = s.id',
      `    and st.curriculum_version = ${q(version)} and st.code = v.strand_code`,
      '  where v.strand_code is null or st.id is not null',
      ...CONFLICT,
      '  get diagnostics v_count = row_count;',
      `  if v_count <> ${picked.length} then`,
      `    raise exception 'curriculum seed: %: % of % ${what} written (a missing subject, grade, strand${specific ? ' or overall attente' : ''}, or an attente the database has with another kind, strand or parent)',`,
      `      ${q(name)}, v_count, ${picked.length};`,
      '  end if;',
    ];
  };
  return [...statement('overall'), ...statement('specific')];
}

/**
 * The seed SQL of the curriculum files. Throws when a file is invalid or says it holds official
 * or verified text, when two files disagree on a version's strands or hold the same grade, when
 * a code appears twice, when a contenu is not in its attente's strand, or when any text contains
 * a quote tag.
 */
export function curriculumToSql(sources: readonly CurriculumSource[]): string {
  const parsed = parseAll(sources);
  const versions = new Map<string, Parsed>();
  for (const p of parsed) {
    const key = `${p.file.subjectCode} ${p.file.curriculumVersion}`;
    if (!versions.has(key)) versions.set(key, p);
  }
  const all = parsed.flatMap((p) => p.file.expectations);
  const overall = all.filter((e) => e.kind === 'overall').length;
  const strandCount = [...versions.values()].reduce((n, p) => n + p.file.strands.length, 0);

  const body: string[] = [];
  for (const p of versions.values()) body.push(...strandsSql(p), '');
  for (const p of parsed) body.push(...expectationsSql(p), '');

  return [
    '-- Generated by `pnpm library:seed` from content/curriculum. Do not edit by hand.',
    `-- Curriculum sample: ${parsed.length} files, ${strandCount} strands, ${all.length} attentes ` +
      `(${overall} overall, ${all.length - overall} contenus).`,
    '-- Paraphrased summaries, not the official text: every row is unverified (D-030) and shows',
    '-- « À vérifier ». Attentes that supabase/seed.sql already has keep their id and wording;',
    '-- only their sort order follows the files. Loaded before the demo library (20_…).',
    `do ${BLOCK_QUOTE}`,
    'declare',
    '  v_count integer;',
    'begin',
    ...body,
    `end ${BLOCK_QUOTE};`,
    '',
  ].join('\n');
}
