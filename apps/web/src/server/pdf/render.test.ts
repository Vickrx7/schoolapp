import { composeSubPlan } from '@lynx/domain';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sheetBodySize } from './activities-document';
import { buildActivitiesPdfModel } from './activities-model';
import { registerPdfFonts } from './fonts';
import { buildPlanPdfModel } from './model';
import { renderActivitiesPdf, renderPlanPdf } from './render';
import {
  activityLayer,
  composed,
  CONTEXT,
  EN_LABELS,
  FR_LABELS,
  FRENCH_TYPOGRAPHY,
  LEVELS,
  pdfPlan,
  ROSTER,
  withScience,
} from './test-fixtures';

// The server runs from apps/web; the tests run from the repository root.
registerPdfFonts(fileURLToPath(new URL('../../../assets/fonts', import.meta.url)));

const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;

function expectPdf(pdf: Buffer) {
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
}

describe('renderPlanPdf', () => {
  it('renders a plan with French typography in the vendored Noto Sans', async () => {
    const model = buildPlanPdfModel(composed('pdf'), CONTEXT, ROSTER, LEVELS, FR_LABELS);
    // « », é and a narrow no-break space (U+202F), as French is typed.
    expect(JSON.stringify(model)).toContain(FRENCH_TYPOGRAPHY);
    expect(FRENCH_TYPOGRAPHY).toMatch(/«.*».*\u202f.*é/);
    const pdf = await renderPlanPdf(model);
    expectPdf(pdf);
    const raw = pdf.toString('latin1');
    // Both weights are embedded, as subsets.
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Bold/);
  });

  it('flows a long lesson over several pages, in English too', async () => {
    const base = pdfPlan();
    const long = Array.from(
      { length: 120 },
      (_, i) => `Paragraphe ${i + 1} : « Le huard » plonge et remonte\u202f; l’élève note l’idée.`,
    ).join('\n');
    const plan = pdfPlan({
      blocks: base.blocks.map((b) =>
        b.lesson ? { ...b, lesson: { ...b.lesson, content: long } } : b,
      ),
    });
    const pdf = await renderPlanPdf(
      buildPlanPdfModel(composed('pdf', plan), CONTEXT, ROSTER, LEVELS, EN_LABELS),
    );
    expectPdf(pdf);
    expect(pages(pdf)).toBeGreaterThan(2);
  });

  it('renders a plan with nothing to cover', async () => {
    const plan = pdfPlan({
      classes: [],
      groups: [],
      blocks: [],
      dayEvents: [],
      classNotes: [],
      faith: null,
    });
    const pdf = await renderPlanPdf(
      buildPlanPdfModel(
        composed('pdf', plan),
        { ...CONTEXT, officePhone: null },
        [],
        [],
        FR_LABELS,
      ),
    );
    expectPdf(pdf);
    expect(pages(pdf)).toBe(1);
  });
});

describe('renderActivitiesPdf', () => {
  /** French text of exactly `n` characters. */
  const fill = (n: number) => {
    const sentence =
      'Lis la consigne avec ton ou ta camarade, puis écris ta réponse dans ton cahier. ';
    return sentence.repeat(Math.ceil(n / sentence.length)).slice(0, n);
  };

  it('renders one page per group, even for the longest activity the AI may write', async () => {
    // The longest parts validateSubPlan lets through: a 120-character title, 1 200 characters
    // for the class and 800 for a group, with line breaks.
    const longest = {
      title: fill(120),
      studentInstructions: `${fill(400)}\n${fill(400)}\n${fill(398)}`,
      perGroup: [
        { group: 'G1', studentInstructions: `${fill(399)}\n${fill(400)}` },
        { group: 'G2', studentInstructions: 'Nomme trois forces.' },
      ],
    };
    const short = {
      title: 'Les forces autour de moi',
      studentInstructions: 'Observe la classe.',
      perGroup: [
        { group: 'G1', studentInstructions: 'Dessine une poussée.' },
        { group: 'G2', studentInstructions: 'Nomme trois forces.' },
      ],
    };
    const model = buildActivitiesPdfModel(
      composeSubPlan(withScience(), { ai: activityLayer(longest, short), audience: 'pdf' }),
      ROSTER,
      LEVELS,
    );
    expect(model.sheets).toHaveLength(4);
    const pdf = await renderActivitiesPdf(model);
    expectPdf(pdf);
    expect(pages(pdf)).toBe(4);
    // Large print for a short activity; smaller for a long one, so that it stays on its page.
    const sizes = model.sheets.map(sheetBodySize);
    expect(sizes[3]).toBe(15);
    expect(sizes[0]).toBeLessThan(sizes[3]!);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Bold/);
  });

  it('refuses to render a document without a sheet', async () => {
    const model = buildActivitiesPdfModel(composed('pdf'), ROSTER, LEVELS);
    expect(model.sheets).toEqual([]);
    await expect(renderActivitiesPdf(model)).rejects.toThrow(/No activity sheet/);
  });
});
