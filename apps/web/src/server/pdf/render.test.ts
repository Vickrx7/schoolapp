import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registerPdfFonts } from './fonts';
import { buildPlanPdfModel } from './model';
import { renderPlanPdf } from './render';
import {
  composed,
  CONTEXT,
  EN_LABELS,
  FR_LABELS,
  FRENCH_TYPOGRAPHY,
  LEVELS,
  pdfPlan,
  ROSTER,
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
