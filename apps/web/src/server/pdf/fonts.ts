/**
 * The PDF font (DECISIONS D-053). React-PDF's built-in fonts cover Latin-1 only, so plans are set
 * in Noto Sans, vendored under apps/web/assets/fonts with its licence (OFL.txt, SIL Open Font
 * License 1.1): the static, unhinted TTFs of Noto Sans 2.015 from the Noto project
 * (github.com/notofonts/notofonts.github.io, fonts/NotoSans/unhinted/ttf). React-PDF reads TTF
 * and WOFF, not WOFF2. The files are read from disk when the first PDF is rendered;
 * next.config.ts traces them into the standalone build (outputFileTracingIncludes).
 *
 * Not server-only, so the renderer can be unit tested; only route handlers import it.
 */
import path from 'node:path';
import { Font } from '@react-pdf/renderer';

export const PDF_FONT_FAMILY = 'NotoSans';

/** apps/web/assets/fonts: the server runs from apps/web (`next start`, standalone server.js). */
export function pdfFontDir(): string {
  return path.join(process.cwd(), 'assets', 'fonts');
}

let registered = false;

/**
 * Registers Noto Sans regular and bold once per process (later calls do nothing), and turns
 * hyphenation off: React-PDF's English hyphenation would break French words in the wrong places,
 * and teacher text is printed as typed. There is no italic face: styles never ask for one.
 */
export function registerPdfFonts(dir: string = pdfFontDir()): void {
  if (registered) return;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(dir, 'NotoSans-Regular.ttf'), fontWeight: 400 },
      { src: path.join(dir, 'NotoSans-Bold.ttf'), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/** What `warmPdfFonts` needs of a fontkit font (fontkit ships no types). */
interface GlyphSource {
  /** Every character the font maps to a glyph. */
  characterSet: number[];
  glyphForCodePoint(codePoint: number): unknown;
  layout(text: string): unknown;
}

/**
 * The ligatures (« ﬁ », « ﬀ »…): their glyphs are for several letters. Noto Sans also maps them
 * as characters of their own (U+FB00 to U+FB06), which would give them one letter.
 */
export const PDF_LIGATURE_FORMS = /[\ufb00-\ufb4f]/u;
const LIGATURES = 'ff fi fl ffi ffl';

let warmed: Promise<void> | null = null;

/**
 * Creates the glyph of every character of both weights from that character, once per process,
 * before anything is laid out. fontkit keeps one glyph object per glyph for the life of the font,
 * with the characters it was first created for, and a document is laid out with the fonts of the
 * documents before it; React-PDF finds where a line may break from those characters.
 *
 * - Embedding « É » creates the glyph of « E » as a part of « É », with no character of its own;
 *   a later document that lays out « E » in that weight then gets that glyph, and React-PDF drops
 *   it (a bold « Exemple » printed as « xemple »). The same goes for every accented letter
 *   (À, Ç, Ô, é, î…) and its parts. No two characters of Noto Sans share a glyph, so each glyph
 *   gets its own character.
 * - A ligature must be created from its letters (« fi »), never from its own character
 *   (« ﬁ »): with one letter instead of two, every later line with an « fi » breaks one letter
 *   off (« planification : t | rier »). `pdfText` spells out the ligature characters.
 *
 * Call after `registerPdfFonts`.
 */
export function warmPdfFonts(): Promise<void> {
  warmed ??= (async () => {
    for (const fontWeight of [400, 700]) {
      const source = Font.getFont({ fontFamily: PDF_FONT_FAMILY, fontWeight });
      await source.load();
      const font = source.data as unknown as GlyphSource | null;
      if (!font) throw new Error(`The PDF font (weight ${fontWeight}) did not load`);
      font.layout(LIGATURES);
      for (const codePoint of font.characterSet) {
        if (!PDF_LIGATURE_FORMS.test(String.fromCodePoint(codePoint))) {
          font.glyphForCodePoint(codePoint);
        }
      }
    }
  })().catch((error: unknown) => {
    // Tried again by the next render.
    warmed = null;
    throw error;
  });
  return warmed;
}
