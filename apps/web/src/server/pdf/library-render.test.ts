import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DOC_LABELS_FR,
  LIBRARY_ITEM_TYPES,
  sampleCanonical,
  seedItemSchema,
  type RenderedDoc,
} from '@lynx/content';
import { Font } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { studentVersionDocs, teacherVersionDocs } from '../library/item-docs';
import { PDF_TEXT_SUBSTITUTES, pdfText } from './doc-blocks';
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts';
import {
  FRENCH_PROMPT,
  libraryView,
  quizItem,
  studentSource,
  versionView,
} from './library-fixtures';
import { buildStudentPdfModel, buildTeacherPdfModel, type LibraryPdfModel } from './library-model';
import { renderLibraryPdf } from './render';

// The server runs from apps/web; the tests run from the repository root.
registerPdfFonts(fileURLToPath(new URL('../../../assets/fonts', import.meta.url)));

const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;

function expectPdf(pdf: Buffer) {
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
}

function model(docs: RenderedDoc[], doc: LibraryPdfModel['doc'] = 'student'): LibraryPdfModel {
  return {
    doc,
    info: { title: 'Essai', language: 'fr-CA' },
    fileName: 'essai.pdf',
    pages: docs.map((d, i) => ({ key: String(i), doc: d })),
    partial: false,
  };
}

/** A short quiz: one question, so that each of its documents fits on one page. */
function shortQuiz() {
  const { item, keys } = quizItem();
  const versions = item.versions.map((v) => {
    const content = v.content as { questions: unknown[] };
    return { ...v, content: { ...content, questions: content.questions.slice(0, 1) } };
  });
  return { item: { ...item, versions }, keys };
}

/** The demo resources (content/library/demo), with the item page's view of each. */
function seedItems() {
  const dir = new URL('../../../../../content/library/demo/items/', import.meta.url);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const seed = seedItemSchema.parse(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
      const versions = seed.versions.map((v, i) => versionView(i + 1, v.content));
      const item = libraryView(seed.type, {
        title: seed.title,
        versions,
        materials: seed.materials,
        durationMinutes: seed.durationMinutes,
        safetyNotes: seed.safetyNotes,
        faith: {
          content: seed.faithContent,
          connection: seed.catholicConnection || null,
          referenceId: null,
          referenceTitle: seed.catholicReference,
          onStudentSheet: seed.faithOnStudentSheet,
          requiresReview: false,
          reviewed: false,
        },
      });
      const keys = new Map(seed.versions.map((v, i) => [versions[i]!.id, v.answerKey]));
      return { slug: seed.slug, item, keys };
    });
}

/** Every string a document prints (ids and enum values aside). */
function printedStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) printedStrings(v, out);
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (!['type', 'kind', 'lang', 'tone'].includes(key)) printedStrings(v, out);
    }
  }
  return out;
}

describe('renderLibraryPdf', () => {
  it('renders a quiz with French typography in the vendored Noto Sans', async () => {
    const { item } = quizItem();
    const student = buildStudentPdfModel(studentSource(item, item.versions.slice(0, 1)), 5);
    // « », é and a narrow no-break space (U+202F), as French is typed.
    expect(FRENCH_PROMPT).toMatch(/«.*».*\u202f.*é/);
    expect(JSON.stringify(student)).toContain(FRENCH_PROMPT);
    const pdf = await renderLibraryPdf(student);
    expectPdf(pdf);
    const raw = pdf.toString('latin1');
    // Both weights are embedded, as subsets (the question numbers are bold).
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+NotoSans-Bold/);
    // The document's properties: its title and French.
    expect(raw).toContain('/Lang (fr-CA)');
  });

  it('starts each version on a page of its own', async () => {
    const { item, keys } = shortQuiz();
    const student = buildStudentPdfModel(studentSource(item), item.versions.length);
    expect(student.pages).toHaveLength(5);
    expect(pages(await renderLibraryPdf(student))).toBe(5);
    // The guide, then a key for each of the two versions chosen.
    const teacher = buildTeacherPdfModel(item, item.versions.slice(0, 2), keys);
    expect(teacher.pages).toHaveLength(3);
    expect(pages(await renderLibraryPdf(teacher))).toBe(3);
  });

  it('flows a long reading passage over several pages', async () => {
    const { content } = sampleCanonical('reading_passage');
    const paragraph =
      'Le huard plonge sous l’eau pour attraper des poissons, puis il remonte à la surface. ';
    const text = Array.from({ length: 60 }, () => paragraph.repeat(4)).join('\n');
    const item = libraryView('reading_passage', {
      versions: [versionView(1, { ...content, text })],
    });
    const pdf = await renderLibraryPdf(buildStudentPdfModel(studentSource(item), 1));
    expectPdf(pdf);
    expect(pages(pdf)).toBeGreaterThan(5);
  });

  it('renders every type: the student sheet, the guide and the key', async () => {
    const docs = LIBRARY_ITEM_TYPES.flatMap((type) => {
      const { content, answerKey } = sampleCanonical(type);
      const item = libraryView(type, { versions: [versionView(1, content)] });
      const source = {
        type,
        title: item.title,
        faith: { connection: null, onStudentSheet: false },
      };
      const student = studentVersionDocs(source, { number: 1, content }).student;
      const teacher = teacherVersionDocs(item, item.versions[0]!, answerKey);
      return [student, teacher.teacher, teacher.answerKey].filter((d) => d !== null);
    });
    // 23 student sheets (not the lesson plan and the teacher guide), 25 guides and the keys.
    expect(docs.length).toBeGreaterThan(48);
    const pdf = await renderLibraryPdf(model(docs, 'teacher'));
    expectPdf(pdf);
    expect(pages(pdf)).toBeGreaterThanOrEqual(docs.length);
  }, 60_000);

  it('refuses to render a document without a page', async () => {
    await expect(renderLibraryPdf(model([]))).rejects.toThrow(/No library page/);
  });
});

describe('the characters the PDFs print', () => {
  const fonts = async () =>
    Promise.all(
      [400, 700].map(async (fontWeight) => {
        const source = Font.getFont({ fontFamily: PDF_FONT_FAMILY, fontWeight });
        await source.load();
        return source.data as unknown as { hasGlyphForCodePoint(codePoint: number): boolean };
      }),
    );

  it('replaces the arrows Noto Sans lacks with characters it has', async () => {
    const [regular, bold] = await fonts();
    for (const [missing, replacement] of Object.entries(PDF_TEXT_SUBSTITUTES)) {
      expect(regular!.hasGlyphForCodePoint(missing.codePointAt(0)!)).toBe(false);
      for (const c of replacement) {
        expect(regular!.hasGlyphForCodePoint(c.codePointAt(0)!)).toBe(true);
        expect(bold!.hasGlyphForCodePoint(c.codePointAt(0)!)).toBe(true);
      }
    }
    expect(pdfText('1 → B · 2 → A')).toBe('1 – B · 2 – A');
    // French typography is kept as typed; a separate accent is composed with its letter.
    expect(pdfText(FRENCH_PROMPT)).toBe(FRENCH_PROMPT);
    expect(pdfText('E\u0301tapes')).toBe('\u00c9tapes');
  });

  it('has a glyph for every character of the demo resources and the document labels', async () => {
    const [regular, bold] = await fonts();
    const strings = seedItems().flatMap(({ item, keys }) => [
      ...printedStrings(buildStudentPdfModel(studentSource(item), item.versions.length).pages),
      ...printedStrings(buildTeacherPdfModel(item, item.versions, keys).pages),
    ]);
    const labels = printedStrings(
      Object.values(DOC_LABELS_FR).map((l) => (typeof l === 'function' ? l(2) : l)),
    );
    const missing = new Set<string>();
    for (const text of [...strings, ...labels, '•', '\u00a0: ']) {
      for (const c of pdfText(text)) {
        if (c === '\n') continue;
        const codePoint = c.codePointAt(0)!;
        if (!regular!.hasGlyphForCodePoint(codePoint) || !bold!.hasGlyphForCodePoint(codePoint)) {
          missing.add(`U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ${c}`);
        }
      }
    }
    expect([...missing]).toEqual([]);
    expect(strings.length).toBeGreaterThan(1000);
  });

  it('renders the longest demo resource, a reading passage in five versions', async () => {
    const canot = seedItems().find((s) => s.slug === 'canot-des-voyageurs')!;
    const student = buildStudentPdfModel(studentSource(canot.item), canot.item.versions.length);
    expect(student.pages).toHaveLength(5);
    const pdf = await renderLibraryPdf(student);
    expectPdf(pdf);
    expect(pages(pdf)).toBeGreaterThan(5);
  }, 60_000);
});
