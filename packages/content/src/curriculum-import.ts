/**
 * The curriculum import file (DECISIONS P-10, D-030): JSON only, validated here and applied by
 * `pnpm admin import-curriculum` (a dry run unless `--apply`). Strands are upserted by
 * (subject, version, code), then overall attentes and specific ones by (subject, grade,
 * version, code), parents resolved by code within the file. A file that says it holds the
 * official or verified text needs `--confirm-licence`: licensing must be confirmed before
 * official Ministry text goes into a commercial product.
 */
import { z } from 'zod';
import { GRADE_CODE_PATTERN } from './schemas';

export const LICENCE_WARNING =
  'This file says it contains official or verified curriculum text. Official Ministry of ' +
  'Education text (and the Catholic graduate expectations and religion curriculum, which ' +
  'belong to Catholic education bodies) may only be loaded into a commercial product once ' +
  'the licence is confirmed (DECISIONS D-030). Re-run with --confirm-licence only if it is.';

const code = z.string().trim().min(1, 'required').max(20, 'tooLong');

const strandSchema = z.strictObject({
  code,
  labelFr: z.string().trim().min(1, 'required').max(200, 'tooLong'),
  labelEn: z.string().trim().max(200, 'tooLong').nullable().default(null),
});

const expectationSchema = z.strictObject({
  grade: z.string().regex(GRADE_CODE_PATTERN, 'invalidGrade'),
  code,
  kind: z.enum(['overall', 'specific'], { error: 'invalidKind' }),
  strandCode: code.nullable(),
  /** Null for an overall attente; the code of its overall attente (same grade) otherwise. */
  parentCode: code.nullable(),
  textFr: z.string().trim().min(1, 'required').max(2000, 'tooLong'),
  textEn: z.string().trim().max(2000, 'tooLong').nullable().default(null),
});

export const curriculumFileSchema = z
  .strictObject({
    /** The text is the Ministry's own wording. */
    official: z.boolean(),
    /** The text was checked against the official document (`is_verified`). */
    verified: z.boolean(),
    subjectCode: z.string().regex(/^[a-z0-9_]{2,32}$/, 'invalid'),
    curriculumVersion: z.string().trim().min(1, 'required').max(40, 'tooLong'),
    sourceNote: z.string().trim().max(500, 'tooLong').nullable().default(null),
    strands: z.array(strandSchema).max(50, 'tooMany'),
    expectations: z.array(expectationSchema).min(1, 'required').max(5000, 'tooMany'),
  })
  .superRefine((file, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const strandCodes = new Set<string>();
    file.strands.forEach((strand, i) => {
      if (strandCodes.has(strand.code)) issue(['strands', i, 'code'], 'duplicateCode');
      strandCodes.add(strand.code);
    });
    const byKey = new Map<string, (typeof file.expectations)[number]>();
    file.expectations.forEach((e, i) => {
      const key = `${e.grade}:${e.code}`;
      if (byKey.has(key)) issue(['expectations', i, 'code'], 'duplicateCode');
      else byKey.set(key, e);
      if (e.strandCode !== null && !strandCodes.has(e.strandCode)) {
        issue(['expectations', i, 'strandCode'], 'unknownStrand');
      }
    });
    file.expectations.forEach((e, i) => {
      if (e.kind === 'overall') {
        if (e.parentCode !== null) issue(['expectations', i, 'parentCode'], 'overallHasParent');
        return;
      }
      if (e.parentCode === null) {
        issue(['expectations', i, 'parentCode'], 'parentRequired');
        return;
      }
      const parent = byKey.get(`${e.grade}:${e.parentCode}`);
      if (!parent) issue(['expectations', i, 'parentCode'], 'unknownParent');
      else if (parent.kind !== 'overall')
        issue(['expectations', i, 'parentCode'], 'parentNotOverall');
    });
  });
export type CurriculumFile = z.output<typeof curriculumFileSchema>;

export interface CurriculumImportError {
  /** Dotted path in the file (`expectations.3.parentCode`); `''` for the whole file. */
  path: string;
  message: string;
}

export interface ParsedCurriculumFile {
  data: CurriculumFile | null;
  errors: CurriculumImportError[];
}

/**
 * Validates a curriculum file (JSON text or an already parsed value). `data` is null whenever
 * there is an error, including an official or verified file without `confirmLicence`.
 */
export function parseCurriculumFile(
  json: unknown,
  options: { confirmLicence?: boolean } = {},
): ParsedCurriculumFile {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch {
      return { data: null, errors: [{ path: '', message: 'invalidJson' }] };
    }
  }
  const parsed = curriculumFileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      data: null,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    };
  }
  const { official, verified } = parsed.data;
  if ((official || verified) && !options.confirmLicence) {
    return {
      data: null,
      errors: [
        { path: official ? 'official' : 'verified', message: 'licenceConfirmationRequired' },
      ],
    };
  }
  return { data: parsed.data, errors: [] };
}
