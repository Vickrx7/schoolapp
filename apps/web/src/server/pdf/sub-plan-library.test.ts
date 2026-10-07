/**
 * A substitute plan's library resource on paper (DECISIONS D-077, D-062, D-042): the plan PDF
 * prints the resource's guide and says where the students' pages are; « Activités pour les
 * élèves » prints each group's version with the group's key in the corner. No answer key ever,
 * no level name and no first name on a student's page.
 */
import { sampleCanonical } from '@lynx/content';
import {
  composeSubPlan,
  librarySnapshot,
  subPlanEditsSchema,
  subPlanSourcesSchema,
  subPlanV1Schema,
  type SubPlanV1,
} from '@lynx/domain';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { studentPages } from './activities-document';
import { buildActivitiesPdfModel, hasActivitySheets } from './activities-model';
import { registerPdfFonts } from './fonts';
import { buildPlanPdfModel } from './model';
import { renderActivitiesPdf, renderPlanPdf } from './render';
import {
  BLOCK,
  CONTEXT,
  FR_LABELS,
  LESSON_4,
  LEVELS,
  pdfPlan,
  ROSTER,
  withScience,
} from './test-fixtures';

registerPdfFonts(fileURLToPath(new URL('../../../assets/fonts', import.meta.url)));

const KEY_SENTINEL = 'SENTINELLE-CORRIGE';
const DEBUTANT_TEXT = 'Le huard est un grand oiseau. Il vit sur les lacs.';
const ITEM = '60000000-0000-4000-8000-000000000099';
const [DEBUTANT, AVANCE] = LEVELS.map((l) => l.id) as [string, string];

/** A reading passage with a Débutant version, and a key the loader must never send. */
function libraryItem() {
  const { content } = sampleCanonical('reading_passage');
  const version = (levelId: string | null, text?: string) => ({
    levelId,
    schemaVersion: 1,
    content: text ? { ...content, text } : content,
    // Sent by mistake: reading the sources drops it.
    answerKey: { answers: [{ questionId: 'q1', sampleAnswer: KEY_SENTINEL }], solution: '' },
  });
  const parsed = subPlanSourcesSchema.shape.library.parse({
    lessonCandidates: [],
    items: [
      {
        id: ITEM,
        type: 'reading_passage',
        title: 'Le huard, oiseau des lacs',
        status: 'board_approved',
        subFriendly: true,
        durationMinutes: 30,
        materials: 'Une copie du texte par élève.',
        safetyNotes: null,
        catholicConnection: null,
        catholicReferenceTitle: null,
        faithOnStudentSheet: false,
        subjectCode: 'fra',
        usageCount: 0,
        hasAnswerKey: true,
        versions: [version(null), version(DEBUTANT, DEBUTANT_TEXT)],
      },
    ],
  });
  return parsed.items[0]!;
}

/** pdfPlan (or withScience) with the huard on the Français period. */
function withLibrary(base: SubPlanV1 = pdfPlan()): SubPlanV1 {
  const groups = base.groups.map((g) => ({ key: g.key, levelId: g.levelId }));
  const snapshot = librarySnapshot(libraryItem(), groups, { reason: 'expectation' })!;
  return subPlanV1Schema.parse({
    ...base,
    blocks: base.blocks.map((b) => (b.key === BLOCK.french ? { ...b, library: snapshot } : b)),
  });
}

const hide = subPlanEditsSchema.parse({
  blocks: { [BLOCK.french]: { forLessonId: LESSON_4, hideLibrary: true } },
});

describe('the plan PDF with a library resource', () => {
  it('prints the resource’s guide and where the students’ pages are, never a key', () => {
    const plan = composeSubPlan(withLibrary(), { audience: 'pdf' });
    const model = buildPlanPdfModel(plan, CONTEXT, ROSTER, LEVELS, FR_LABELS);
    const schedule = model.sections.find((s) => s.id === 'schedule')!;
    const french = schedule.blocks.find((b) => b.key === BLOCK.french)!;
    expect(french.library).toMatchObject({
      heading: 'Ressource de la banque\u00a0: Le huard, oiseau des lacs',
      guideLabel: 'Guide de la ressource',
      notes: [
        'Matériel pour les élèves\u00a0: «\u00a0Activités pour les élèves (PDF)\u00a0», une copie par groupe.',
        'Le corrigé reste avec l’enseignant·e\u00a0: ramassez les feuilles.',
      ],
    });
    expect(french.library!.guide.kind).toBe('teacher');
    expect(JSON.stringify(model)).not.toContain(KEY_SENTINEL);
    expect(JSON.stringify(model)).not.toMatch(/"type":"answer"/);
    // Other periods have none.
    expect(schedule.blocks.filter((b) => b.library)).toHaveLength(1);
  });

  it('prints nothing of a resource the teacher hid', () => {
    const plan = composeSubPlan(withLibrary(), { edits: hide, audience: 'pdf' });
    const model = buildPlanPdfModel(plan, CONTEXT, ROSTER, LEVELS, FR_LABELS);
    expect(JSON.stringify(model)).not.toContain('Ressource de la banque');
  });

  it('renders as a PDF', async () => {
    const plan = composeSubPlan(withLibrary(), { audience: 'pdf' });
    const pdf = await renderPlanPdf(buildPlanPdfModel(plan, CONTEXT, ROSTER, LEVELS, FR_LABELS));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('« Activités pour les élèves » with a library resource', () => {
  it('prints one copy per group on the roster, each in its group’s version', () => {
    const plan = composeSubPlan(withLibrary(), { audience: 'pdf' });
    expect(hasActivitySheets(plan)).toBe(true);
    const model = buildActivitiesPdfModel(plan, ROSTER, LEVELS);
    expect(model.sheets).toEqual([]);
    // G1 Débutant, G2 Avancé; G3 has no student on the roster any more.
    expect(model.librarySheets.map((s) => [s.blockKey, s.group])).toEqual([
      [BLOCK.french, 'G1'],
      [BLOCK.french, 'G2'],
    ]);
    const [g1, g2] = model.librarySheets;
    expect(JSON.stringify(g1!.doc)).toContain(DEBUTANT_TEXT);
    expect(JSON.stringify(g2!.doc)).not.toContain(DEBUTANT_TEXT);
    expect(plan.groups.find((g) => g.key === 'G2')!.levelId).toBe(AVANCE);

    const text = JSON.stringify(model.librarySheets);
    expect(text).not.toContain(KEY_SENTINEL);
    for (const level of LEVELS) expect(text).not.toContain(level.labelFr);
    for (const s of ROSTER) expect(text).not.toContain(s.firstName);
    for (const sheet of model.librarySheets) expect(sheet.doc.number).toBeNull();
  });

  it('keeps the order of the day: each period’s activity pages, then its resource’s', () => {
    const activity = {
      title: 'Les forces autour de moi',
      studentInstructions: 'Observe la classe.',
      perGroup: [],
    };
    const ai = {
      jobId: 'job',
      refs: [
        { key: 'B2', ref: { blockKey: '60000000-0000-4000-8000-000000000006', lessonId: null } },
      ],
      result: {
        dayOverview: '',
        blocks: [
          {
            key: 'B2',
            overview: '',
            steps: [],
            differentiation: [],
            ifTimeRemains: '',
            materialsChecklist: [],
            activity,
          },
        ],
        faithSentence: '',
      },
    };
    const plan = composeSubPlan(withLibrary(withScience()), { ai, audience: 'pdf' });
    const model = buildActivitiesPdfModel(plan, ROSTER, LEVELS);
    expect(studentPages(model).map((p) => [p.kind, p.sheet.group])).toEqual([
      ['library', 'G1'],
      ['library', 'G2'],
      ['activity', 'G1'],
      ['activity', 'G2'],
    ]);
  });

  it('has nothing to print once the teacher hid the resource', () => {
    const plan = composeSubPlan(withLibrary(), { edits: hide, audience: 'pdf' });
    expect(hasActivitySheets(plan)).toBe(false);
    expect(buildActivitiesPdfModel(plan, ROSTER, LEVELS).librarySheets).toEqual([]);
  });

  it('renders the resource’s pages as a PDF', async () => {
    const model = buildActivitiesPdfModel(
      composeSubPlan(withLibrary(), { audience: 'pdf' }),
      ROSTER,
      LEVELS,
    );
    const pdf = await renderActivitiesPdf(model);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(2);
  });
});
