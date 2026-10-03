import { composeSubPlan, typedItem, withTeacherEnglish } from '@lynx/domain';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sheetBodySize } from './activities-document';
import { buildActivitiesPdfModel } from './activities-model';
import { registerPdfFonts } from './fonts';
import { buildPlanPdfModel } from './model';
import {
  NEWSLETTER_BODY_SIZES,
  NEWSLETTER_PAGE_ROOM,
  newsletterPageHeight,
} from './newsletter-document';
import { editedNewsletter, newsletterModel } from './newsletter-fixtures';
import {
  pdfPageCount,
  renderActivitiesPdf,
  renderNewsletterPdf,
  renderPlanPdf,
  renderYearPlanPdf,
} from './render';
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
import { YEAR_PLAN_EN, YEAR_PLAN_FR, yearPlanInput } from './year-plan-fixtures';
import { buildYearPlanPdfModel } from './year-plan-model';

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

describe('renderYearPlanPdf', () => {
  /** The pages' sizes: Letter, landscape (792 × 612) or portrait (612 × 792). */
  const mediaBoxes = (pdf: Buffer) =>
    [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map(
      (m) => `${Math.round(Number(m[1]))}x${Math.round(Number(m[2]))}`,
    );

  it('renders the year at a glance in landscape, then the units by subject', async () => {
    const pdf = await renderYearPlanPdf(buildYearPlanPdfModel(yearPlanInput(), YEAR_PLAN_FR));
    expectPdf(pdf);
    expect(pages(pdf)).toBe(2);
    expect(mediaBoxes(pdf)).toEqual(['792x612', '612x792']);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Bold/);
  });

  it('adds the coverage page only when asked, in English too', async () => {
    const model = buildYearPlanPdfModel(
      yearPlanInput({
        coverage: {
          rows: [
            {
              label: 'Mathématiques',
              counts: { total: 34, taught: 3, planned: 5, taughtEarlier: 0, notPlanned: 26 },
            },
          ],
          unverified: true,
        },
      }),
      YEAR_PLAN_EN,
    );
    const pdf = await renderYearPlanPdf(model);
    expectPdf(pdf);
    expect(pages(pdf)).toBe(3);
  });

  it('renders a class without units', async () => {
    const pdf = await renderYearPlanPdf(
      buildYearPlanPdfModel(yearPlanInput({ units: [] }), YEAR_PLAN_FR),
    );
    expectPdf(pdf);
    expect(pages(pdf)).toBe(2);
  });
});

describe('renderNewsletterPdf', () => {
  const mediaBoxes = (pdf: Buffer) =>
    [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map(
      (m) => `${Math.round(Number(m[1]))}x${Math.round(Number(m[2]))}`,
    );
  const short = ['Merci pour votre aide à la fête de l’automne!', 'Thanks for your help!'] as const;
  const long = [
    'Nous avons préparé une belle surprise pour la fête de l’automne, avec des chansons à 13 h 35. '
      .repeat(3)
      .trim(),
    'We prepared a lovely surprise for the fall party, with songs at 1:35 p.m. '.repeat(3).trim(),
  ] as const;
  /** The week's message with `n` more paragraphs of the teacher's (at most 12 in a section). */
  const longer = (n: number, [fr, en]: readonly [string, string] = short) => {
    const content = editedNewsletter();
    for (let i = 0; i < n; i++) {
      content.sections[0]!.items.push(
        withTeacherEnglish(typedItem(`more${String(i).padStart(4, '0')}`, fr), en),
      );
    }
    return content;
  };

  it('prints the week’s message on one Letter page per language, French then English', async () => {
    const pdf = await renderNewsletterPdf(newsletterModel());
    expectPdf(pdf);
    expect(pages(pdf)).toBe(2);
    expect(pdfPageCount(pdf)).toBe(2);
    expect(mediaBoxes(pdf)).toEqual(['612x792', '612x792']);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Bold/);
    for (const lang of ['fr', 'en'] as const) {
      expect(pages(await renderNewsletterPdf(newsletterModel({ lang }))), lang).toBe(1);
    }
  });

  it('keeps a longer message on one page per language with a smaller print', async () => {
    // The most paragraphs whose estimate fits a page at the smallest size.
    const fitsSmallest = (n: number) =>
      newsletterModel({ content: longer(n) }).pages.every(
        (p) => newsletterPageHeight(p, NEWSLETTER_BODY_SIZES.at(-1)!) <= NEWSLETTER_PAGE_ROOM,
      );
    let n = 0;
    while (n < 10 && fitsSmallest(n + 1)) n += 1;
    expect(n).toBeGreaterThan(0);
    const model = newsletterModel({ content: longer(n) });
    // Too long for the largest print, yet on one page per language.
    expect(newsletterPageHeight(model.pages[0]!, NEWSLETTER_BODY_SIZES[0])).toBeGreaterThan(
      NEWSLETTER_PAGE_ROOM,
    );
    expect(pages(await renderNewsletterPdf(model))).toBe(2);
  });

  it('flows a message too long for one page over more, each language on pages of its own', async () => {
    const content = longer(10, long);
    const pdf = await renderNewsletterPdf(newsletterModel({ content }));
    expectPdf(pdf);
    expect(pages(pdf)).toBe(4);
    expect(pages(await renderNewsletterPdf(newsletterModel({ content, lang: 'en' })))).toBe(2);
  });

  it('renders a message with nothing but its header and signature', async () => {
    const content = editedNewsletter();
    for (const s of content.sections) s.off = true;
    const model = newsletterModel({ content });
    expect(model.pages.every((p) => p.sections.length === 0)).toBe(true);
    const pdf = await renderNewsletterPdf(model);
    expectPdf(pdf);
    expect(pages(pdf)).toBe(2);
  });
});
