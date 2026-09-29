/**
 * A library PDF's layout (DECISIONS D-075, D-053, D-042): US Letter, Noto Sans, each document of
 * the model (library-model.ts decides what is printed) starting its own page, with its small
 * version number at the bottom right of every page it takes. Nothing else: no header, no
 * footer, no level name, no name of a person, so a student sheet can be handed out as it is.
 *
 * Plain function components without hooks: React-PDF renders them with its own reconciler.
 * Not server-only, so the renderer can be unit tested; only route handlers import it.
 */
import type { RenderedDoc } from '@lynx/content';
import { Document, Page, StyleSheet, Text } from '@react-pdf/renderer';
import { APP_NAME } from '../../lib/app-name';
import { DOC_TEXT_WIDTH, DocBody } from './doc-blocks';
import { PDF_FONT_FAMILY } from './fonts';
import type { LibraryPdfModel } from './library-model';

const INK = '#0f172a';
const FAINT = '#64748b';

const PAGE = { width: 612, top: 50, bottom: 56 };
const SIDE = (PAGE.width - DOC_TEXT_WIDTH) / 2;

const styles = StyleSheet.create({
  // Line heights are set on each text, never on the page (see plan-document.tsx).
  page: {
    fontFamily: PDF_FONT_FAMILY,
    color: INK,
    paddingTop: PAGE.top,
    paddingBottom: PAGE.bottom,
    paddingHorizontal: SIDE,
  },
  number: {
    position: 'absolute',
    bottom: 26,
    right: SIDE,
    fontSize: 9,
    lineHeight: 1.2,
    color: FAINT,
  },
});

function DocPage({ doc }: { doc: RenderedDoc }) {
  return (
    <Page size="LETTER" style={styles.page}>
      {/* The only mark of the version: its number, small, on every page it takes. */}
      {doc.number !== null ? (
        <Text style={styles.number} fixed>
          {doc.number}
        </Text>
      ) : null}
      <DocBody doc={doc} />
    </Page>
  );
}

export function LibraryDocument({ model }: { model: LibraryPdfModel }) {
  return (
    <Document
      title={model.info.title}
      language={model.info.language}
      creator={APP_NAME}
      producer={APP_NAME}
    >
      {model.pages.map((page) => (
        <DocPage key={page.key} doc={page.doc} />
      ))}
    </Document>
  );
}
