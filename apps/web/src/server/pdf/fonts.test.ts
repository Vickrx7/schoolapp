import { fileURLToPath } from 'node:url';
import { Font } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { pdfText } from './doc-blocks';
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts';
import type { LibraryPdfModel } from './library-model';
import { renderLibraryPdf } from './render';

// The server runs from apps/web; the tests run from the repository root.
registerPdfFonts(fileURLToPath(new URL('../../../assets/fonts', import.meta.url)));

/** A document whose only bold text is accented capitals: « É », « À », « Ç », « Ô », « Î ». */
const accentedCapitals: LibraryPdfModel = {
  doc: 'student',
  info: { title: 'Essai', language: 'fr-CA' },
  fileName: 'essai.pdf',
  pages: [
    {
      key: 'a',
      doc: {
        kind: 'student',
        lang: 'fr-CA',
        title: 'ÉÀÇÔÎ',
        subtitle: '',
        number: null,
        blocks: [{ type: 'heading', level: 2, text: 'Étapes À Ça Ôté Île' }],
      },
    },
  ],
  partial: false,
};

type Glyph = { codePoints: number[] };

describe('warmPdfFonts', () => {
  // Vitest runs each test file in a worker of its own and this file renders nothing else, so the
  // render below is the worker's first: the case that dropped the bold « E » of « Exemple » from
  // every later PDF.
  it('keeps the plain letters of accented capitals whole for the next documents', async () => {
    await renderLibraryPdf(accentedCapitals);
    const source = Font.getFont({ fontFamily: PDF_FONT_FAMILY, fontWeight: 700 });
    const bold = source.data as unknown as { glyphForCodePoint(codePoint: number): Glyph };
    // Embedding « É » used the glyph of « E » as a part: it must still be the glyph of « E »,
    // or React-PDF drops it from the next text that has one.
    for (const letter of 'EACOIeacoi') {
      const codePoint = letter.codePointAt(0)!;
      expect(bold.glyphForCodePoint(codePoint).codePoints).toEqual([codePoint]);
    }
  });

  it('keeps each ligature the glyph of its letters, so lines break between words', async () => {
    await renderLibraryPdf(accentedCapitals);
    for (const fontWeight of [400, 700]) {
      const source = Font.getFont({ fontFamily: PDF_FONT_FAMILY, fontWeight });
      const font = source.data as unknown as {
        glyphForCodePoint(codePoint: number): Glyph;
        layout(text: string): { glyphs: Glyph[] };
      };
      // Noto Sans also maps « ﬁ » (U+FB01) to the glyph of « fi »: it must keep both letters.
      expect(font.glyphForCodePoint(0xfb01).codePoints).toEqual([0x66, 0x69]);
      const word = 'efficacité, planification, réflexion';
      const glyphs = font.layout(word).glyphs;
      expect(glyphs.length).toBeLessThan(word.length);
      expect(glyphs.flatMap((g) => g.codePoints)).toEqual([...word].map((c) => c.codePointAt(0)));
    }
    expect(pdfText('ﬁn ﬂeur ﬀ')).toBe('fin fleur ff');
  });
});
