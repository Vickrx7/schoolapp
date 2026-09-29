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
