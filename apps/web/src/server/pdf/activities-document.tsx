/**
 * The students' activity sheets' layout (DECISIONS D-053, D-042): US Letter, Noto Sans, one page
 * per sheet of the model (activities-model.ts decides what is printed; this file only lays it
 * out). A page has the period's subject, the activity's title, the instructions for the whole
 * class and the group's own version in a box; the group's key sits small in the top corner for
 * the adult. No header, no footer, no name and no level.
 *
 * Print is as large as the text allows: a short activity is set big for young readers, a long
 * one smaller, so that a group's sheet stays on one page.
 *
 * A library resource's page (D-077) is its student document drawn as the library draws it
 * (doc-blocks.tsx), over as many pages as it takes, with the group's key in the corner of each.
 * Pages follow the day: each period's activity pages, then its resource's pages.
 *
 * Plain function components without hooks: React-PDF renders them with its own reconciler.
 * Not server-only, so the renderer can be unit tested; only route handlers import it.
 */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { APP_NAME } from '../../lib/app-name';
import type { ActivitiesPdfModel, ActivitySheet, LibrarySheet } from './activities-model';
import { DocBody } from './doc-blocks';
import { PDF_FONT_FAMILY } from './fonts';

// Tailwind's slate, as on screen and in the plan PDF.
const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#94a3b8';
const RULE = '#cbd5e1';

const PAGE = { width: 612, height: 792, top: 48, bottom: 44, side: 54 };
const TEXT_WIDTH = PAGE.width - 2 * PAGE.side;
const BOX = { border: 1.5, paddingX: 12, paddingY: 10, marginTop: 4 };
const BOX_TEXT_WIDTH = TEXT_WIDTH - 2 * (BOX.border + BOX.paddingX);
/** Body sizes from the largest down: the first one whose sheet fits on a page is used. */
const BODY_SIZES = [15, 14, 13, 12, 11, 10] as const;
const LINE_HEIGHT = 1.5;
const TITLE_RATIO = 1.6;
const TITLE_LINE_HEIGHT = 1.25;

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    color: INK,
    paddingTop: PAGE.top,
    paddingBottom: PAGE.bottom,
    paddingHorizontal: PAGE.side,
  },
  // As in plan-document.tsx, a line height is always set next to its font size, never on the
  // page (React-PDF resolves a line height without one against its own 18 pt default).
  corner: {
    position: 'absolute',
    top: 22,
    right: 30,
    fontSize: 9,
    lineHeight: 1.2,
    color: FAINT,
  },
  subject: {
    fontSize: 10,
    lineHeight: 1.3,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  title: { fontWeight: 700, marginBottom: 14 },
  text: { marginBottom: 12 },
  box: {
    borderWidth: BOX.border,
    borderColor: RULE,
    borderRadius: 6,
    paddingHorizontal: BOX.paddingX,
    paddingVertical: BOX.paddingY,
    marginTop: BOX.marginTop,
  },
  boxLabel: { fontSize: 11, lineHeight: 1.3, fontWeight: 700, color: MUTED, marginBottom: 4 },
});

/**
 * About how many lines a text takes at `size` across `width`: French in Noto Sans averages a
 * little under half an em per character, so this errs on the side of more lines.
 */
function lines(text: string | null, size: number, width: number): number {
  if (!text) return 0;
  const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

/** The height a sheet takes with `size` as its body size, in points. */
function sheetHeight(sheet: ActivitySheet, size: number): number {
  const titleSize = size * TITLE_RATIO;
  let height = sheet.subject ? 10 * 1.3 + 4 : 0;
  height += lines(sheet.title, titleSize, TEXT_WIDTH) * titleSize * TITLE_LINE_HEIGHT + 14;
  height += lines(sheet.instructions, size, TEXT_WIDTH) * size * LINE_HEIGHT + 12;
  if (sheet.groupInstructions) {
    height +=
      BOX.marginTop +
      2 * (BOX.border + BOX.paddingY) +
      11 * 1.3 +
      4 +
      lines(sheet.groupInstructions, size, BOX_TEXT_WIDTH) * size * LINE_HEIGHT;
  }
  return height;
}

/** The largest body size whose sheet fits on one page (the smallest one otherwise). */
export function sheetBodySize(sheet: ActivitySheet): number {
  const room = PAGE.height - PAGE.top - PAGE.bottom;
  return BODY_SIZES.find((size) => sheetHeight(sheet, size) <= room) ?? BODY_SIZES.at(-1)!;
}

function Sheet({ sheet, taskLabel }: { sheet: ActivitySheet; taskLabel: string }) {
  const size = sheetBodySize(sheet);
  const body = { fontSize: size, lineHeight: LINE_HEIGHT };
  return (
    <Page size="LETTER" style={styles.page}>
      {/* The only mark of the group: its key, small, for the adult handing the pages out. */}
      {sheet.group ? (
        <Text style={styles.corner} fixed>
          {sheet.group}
        </Text>
      ) : null}
      {sheet.subject ? <Text style={styles.subject}>{sheet.subject}</Text> : null}
      <Text style={[styles.title, { fontSize: size * TITLE_RATIO, lineHeight: TITLE_LINE_HEIGHT }]}>
        {sheet.title}
      </Text>
      {sheet.instructions ? <Text style={[styles.text, body]}>{sheet.instructions}</Text> : null}
      {sheet.groupInstructions ? (
        <View style={styles.box}>
          <Text style={styles.boxLabel}>{taskLabel}</Text>
          <Text style={body}>{sheet.groupInstructions}</Text>
        </View>
      ) : null}
    </Page>
  );
}

/** A group's copy of a library resource: the document, its group's key on every page. */
function LibraryPage({ sheet }: { sheet: LibrarySheet }) {
  return (
    <Page size="LETTER" style={styles.page}>
      {sheet.group ? (
        <Text style={styles.corner} fixed>
          {sheet.group}
        </Text>
      ) : null}
      <DocBody doc={sheet.doc} />
    </Page>
  );
}

type StudentPage =
  { kind: 'activity'; sheet: ActivitySheet } | { kind: 'library'; sheet: LibrarySheet };

/**
 * Period by period, in the order of the day: a period's activity pages, then its resource's
 * pages (each list keeps its own order). A block the order does not know comes last.
 */
export function studentPages(model: ActivitiesPdfModel): StudentPage[] {
  const position = new Map(model.blockOrder.map((key, i) => [key, i]));
  const at = (page: StudentPage) => position.get(page.sheet.blockKey) ?? model.blockOrder.length;
  const pages: StudentPage[] = [
    ...model.sheets.map((sheet) => ({ kind: 'activity' as const, sheet })),
    ...model.librarySheets.map((sheet) => ({ kind: 'library' as const, sheet })),
  ];
  // Array.prototype.sort is stable: equal positions keep the order above.
  return pages.sort((a, b) => at(a) - at(b));
}

export function ActivitiesDocument({ model }: { model: ActivitiesPdfModel }) {
  return (
    <Document
      title={model.info.title}
      language={model.info.language}
      creator={APP_NAME}
      producer={APP_NAME}
    >
      {studentPages(model).map((page, i) =>
        page.kind === 'activity' ? (
          <Sheet
            key={`${page.sheet.blockKey}:${page.sheet.group ?? 'class'}`}
            sheet={page.sheet}
            taskLabel={model.taskLabel}
          />
        ) : (
          <LibraryPage key={`library:${page.sheet.blockKey}:${i}`} sheet={page.sheet} />
        ),
      )}
    </Document>
  );
}
