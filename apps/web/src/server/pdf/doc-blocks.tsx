/**
 * A library document (`RenderedDoc`, DECISIONS D-075) drawn with React-PDF: the same blocks, in the
 * same order and with the same words as the HTML `DocView`, in the vendored Noto Sans (D-053).
 * The library's PDFs (library-document.tsx) put each document on its own pages; substitute plans
 * can put a document inside their own pages with `DocBody`.
 *
 * - Choice boxes and writing lines are bordered views, never glyphs, as on screen.
 * - There is no italic face (fonts.ts): what the screen sets in italics is set in a muted colour.
 * - Documents are French whatever the reader's language: the few words added here (« Indice »,
 *   « Vrai »…) are the document labels of `@lynx/content`, never the message files. React-PDF has
 *   no per-element language, so the English half of a family guide is only its own section.
 * - A question, a short callout, an answer, a list item or a table row is never split between two
 *   pages; a heading or a caption is never left alone at the bottom of one. Longer blocks flow.
 * - Space between blocks is always a top margin, never a bottom one: React-PDF moves a whole block
 *   to the next page when only its bottom margin would not fit (it counts the margin as room the
 *   block needs after it), which left a heading alone above a blank half page.
 *
 * Plain function components without hooks: React-PDF renders them with its own reconciler.
 * Not server-only, so the renderer can be unit tested; only route handlers import it.
 */
import {
  DOC_LABELS_FR,
  labelled,
  type CalloutTone,
  type DocBlock,
  type DocOption,
  type LeafBlock,
  type QuestionBlock,
  type RenderedDoc,
} from '@lynx/content';
import { Text, View } from '@react-pdf/renderer';
import type { ComponentProps, ReactNode } from 'react';
import { PDF_LIGATURE_FORMS } from './fonts';

type PdfStyle = ComponentProps<typeof Text>['style'];

const L = DOC_LABELS_FR;

// Tailwind's slate, brand, amber, violet and red, as `DocView` draws them on screen.
const INK = '#0f172a';
const MUTED = '#475569';
const BOX = '#64748b';
const WRITING_LINE = '#94a3b8';
const GRID = '#cbd5e1';
const HEAD = '#f8fafc';
const TONES: Record<CalloutTone, { bar: string; background: string }> = {
  info: { bar: '#93b4fd', background: '#eef4ff' },
  teacher: { bar: '#94a3b8', background: '#f8fafc' },
  safety: { bar: '#f59e0b', background: '#fffbeb' },
  faith: { bar: '#a78bfa', background: '#f5f3ff' },
  warning: { bar: '#f87171', background: '#fef2f2' },
};

/** Line height of body text (a multiple of the font size, always set next to it). */
const LINE = 1.45;

/**
 * The body size of a document, in points: large print for the sheets students read and write
 * on, smaller for the teacher's copy and the key, which are read, not filled in.
 */
export function docBodySize(kind: RenderedDoc['kind']): number {
  return kind === 'student' ? 13 : 10.5;
}

/** The width of the text on a US Letter page with the library's margins (library-document.tsx). */
export const DOC_TEXT_WIDTH = 612 - 2 * 54;
/** The height a block may take and still be kept on one page (a little under half the page). */
const KEEP_TOGETHER_HEIGHT = 300;

/**
 * Characters that Noto Sans has no glyph for, as the nearest text it has. The answer key's
 * matching answers (« 1 → B ») are the only ones the renderers write; the others are the arrows
 * a teacher may type. Everything else prints as typed (the font test checks what the seed and
 * the document labels use).
 */
export const PDF_TEXT_SUBSTITUTES: Readonly<Record<string, string>> = {
  '\u2192': '–', // →
  '\u2190': '–', // ←
  '\u2194': '–', // ↔
  '\u21d2': '–', // ⇒
  '\u27f6': '–', // ⟶
};
const SUBSTITUTED = new RegExp(`[${Object.keys(PDF_TEXT_SUBSTITUTES).join('')}]`, 'gu');

const LIGATURE_FORMS = new RegExp(PDF_LIGATURE_FORMS.source, 'gu');

/**
 * Text as the PDF prints it: accents composed with their letter (text pasted from some systems
 * has « e » followed by a combining accent, which Noto Sans sets less well than « é »), ligature
 * characters pasted from another PDF spelled out (« ﬁ » as « fi », see `warmPdfFonts`), then
 * `PDF_TEXT_SUBSTITUTES`.
 */
export function pdfText(text: string): string {
  return text
    .normalize('NFC')
    .replace(LIGATURE_FORMS, (c) => c.normalize('NFKC'))
    .replace(SUBSTITUTED, (c) => PDF_TEXT_SUBSTITUTES[c] ?? c);
}

/**
 * About how many lines a text takes at `size` across `width`: French in Noto Sans averages a
 * little under half an em per character, so this errs on the side of more lines.
 */
function lineCount(text: string, size: number, width: number): number {
  if (!text) return 0;
  const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

const textHeight = (text: string, size: number, width = DOC_TEXT_WIDTH) =>
  lineCount(text, size, width) * size * LINE;

/** About how tall a question is, to keep short ones on one page. */
function questionHeight(block: QuestionBlock, size: number): number {
  const options = (items: DocOption[]) =>
    items.reduce((h, o) => h + textHeight(`${o.label}) ${o.text}`, size) + size * 0.3, 0);
  return (
    textHeight(`${block.number}. ${block.prompt}`, size) +
    (block.hint ? textHeight(block.hint, size * 0.85) : 0) +
    (block.category ? size * LINE : 0) +
    options(block.choices) +
    Math.max(options(block.left), options(block.right)) +
    block.lines * size * 2.2 +
    size * 2
  );
}

/** Styles that follow the document's size: every text sets its size and line height together. */
function sized(size: number) {
  const small = Math.round(size * 0.85 * 10) / 10;
  return {
    size,
    small,
    /** Between blocks. */
    gap: size * 0.65,
    /** Between the parts of a block (a question's choices, a list's items). */
    step: size * 0.3,
    body: { fontSize: size, lineHeight: LINE } satisfies PdfStyle,
    smallBody: { fontSize: small, lineHeight: LINE } satisfies PdfStyle,
    bold: { fontWeight: 700 } satisfies PdfStyle,
    muted: { color: MUTED } satisfies PdfStyle,
  };
}
type Sized = ReturnType<typeof sized>;

const grow = { flexGrow: 1, flexShrink: 1, flexBasis: 0 } as const;

// ---------------------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------------------

/** An empty box to tick, or (wide) to write a number or a letter in. */
function Box({ s, wide = false }: { s: Sized; wide?: boolean }) {
  const height = wide ? s.size * 1.25 : s.size * 0.8;
  const width = wide ? s.size * 1.7 : s.size * 0.8;
  return (
    <View
      style={{
        width,
        height,
        borderWidth: 1,
        borderColor: BOX,
        borderRadius: 1.5,
        // Centred on the first line of the text next to it.
        marginTop: Math.max(0, (s.size * LINE - height) / 2),
        flexShrink: 0,
      }}
    />
  );
}

/** Ruled lines to write on; they may run over to the next page one line at a time. */
function WritingLines({ s, count, marginTop }: { s: Sized; count: number; marginTop: number }) {
  return (
    <View style={{ marginTop }}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{ height: s.size * 2.2, borderBottomWidth: 0.75, borderBottomColor: WRITING_LINE }}
          wrap={false}
        />
      ))}
    </View>
  );
}

/** An item of a list: its marker, then the text wrapping in the space left. */
function Row({
  s,
  marker,
  first,
  children,
}: {
  s: Sized;
  marker: string;
  first: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', marginTop: first ? 0 : s.size * 0.2 }} wrap={false}>
      <Text style={[s.body, { width: s.size * 1.5, flexShrink: 0 }]}>{marker}</Text>
      <View style={grow}>{children}</View>
    </View>
  );
}

/** A heading or a caption: never the last thing on a page. */
function Title({
  s,
  text,
  factor,
  marginTop,
}: {
  s: Sized;
  text: string;
  factor: number;
  marginTop: number;
}) {
  return (
    <Text
      style={{ fontSize: s.size * factor, lineHeight: 1.3, fontWeight: 700, marginTop }}
      minPresenceAhead={s.size * 4}
      wrap={false}
    >
      {pdfText(text)}
    </Text>
  );
}

// ---------------------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------------------

function ChoiceRow({
  s,
  first,
  wide = false,
  children,
}: {
  s: Sized;
  first: boolean;
  wide?: boolean;
  children: string;
}) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: first ? 0 : s.step }}
      wrap={false}
    >
      <Box s={s} wide={wide} />
      <Text style={[s.body, grow, { marginLeft: s.size * 0.5 }]}>{pdfText(children)}</Text>
    </View>
  );
}

/** « Plusieurs réponses possibles. », « Numérote les éléments… » (italics on screen). */
function Help({ s, text }: { s: Sized; text: string }) {
  return <Text style={[s.smallBody, s.muted]}>{text}</Text>;
}

function Question({ s, block }: { s: Sized; block: QuestionBlock }) {
  const part = { paddingLeft: s.size, marginTop: s.step };
  return (
    <View
      style={{ marginTop: s.gap * 1.3 }}
      wrap={questionHeight(block, s.size) > KEEP_TOGETHER_HEIGHT}
    >
      <Text style={s.body}>
        <Text style={s.bold}>{block.number}.</Text> {pdfText(block.prompt)}
        {block.points ? (
          <Text style={[s.smallBody, s.muted]}> ({L.points(block.points)})</Text>
        ) : null}
      </Text>
      {block.category ? (
        <Text style={[s.smallBody, s.muted]}>{pdfText(block.category)}</Text>
      ) : null}
      {block.hint ? (
        <Text style={[s.smallBody, s.muted, { marginTop: s.size * 0.1 }]}>
          {pdfText(labelled(L.hint, block.hint))}
        </Text>
      ) : null}

      {block.kind === 'multiple_choice' ? (
        <View style={part}>
          {block.multipleAnswers ? <Help s={s} text={L.severalAnswers} /> : null}
          {block.choices.map((c, i) => (
            <ChoiceRow key={i} s={s} first={i === 0 && !block.multipleAnswers}>
              {`${c.label}) ${c.text}`}
            </ChoiceRow>
          ))}
        </View>
      ) : null}

      {block.kind === 'true_false' ? (
        <View style={[part, { flexDirection: 'row', flexWrap: 'wrap' }]} wrap={false}>
          {block.choices.map((c, i) => (
            <View
              key={i}
              style={{ flexDirection: 'row', alignItems: 'flex-start', marginRight: s.size * 2.5 }}
            >
              <Box s={s} />
              <Text style={[s.body, { marginLeft: s.size * 0.5 }]}>{pdfText(c.text)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {block.kind === 'ordering' ? (
        <View style={part}>
          <Help s={s} text={L.orderingHelp} />
          {block.choices.map((c, i) => (
            <ChoiceRow key={i} s={s} first={false} wide>
              {c.text}
            </ChoiceRow>
          ))}
        </View>
      ) : null}

      {block.kind === 'matching' ? (
        <View style={part}>
          <Help s={s} text={L.matchingHelp} />
          <View style={{ flexDirection: 'row' }}>
            <View style={[grow, { marginRight: s.size * 1.5 }]}>
              {block.left.map((o, i) => (
                <View
                  key={i}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: s.step }}
                  wrap={false}
                >
                  <Text style={[s.body, grow]}>{pdfText(`${o.label}. ${o.text}`)}</Text>
                  <View style={{ marginLeft: s.size * 0.5 }}>
                    <Box s={s} wide />
                  </View>
                </View>
              ))}
            </View>
            <View style={grow}>
              {block.right.map((o, i) => (
                <Text key={i} style={[s.body, { marginTop: s.step }]}>
                  {pdfText(`${o.label}) ${o.text}`)}
                </Text>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {block.kind === 'short_answer' && block.lines > 0 ? (
        <WritingLines s={s} count={block.lines} marginTop={0} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------
// Tables (observation tables and rubrics)
// ---------------------------------------------------------------------------------------

/**
 * A grid whose rows are never split. Every cell has its four borders and overlaps its neighbours
 * by one border width, so the lines stay single and a row that starts a new page still has its
 * top line.
 */
function Grid({
  s,
  caption,
  header,
  rows,
  weights,
  size,
  minRowHeight,
}: {
  s: Sized;
  caption: string;
  header: string[];
  rows: ReactNode[][];
  /** The relative width of each column. */
  weights: number[];
  /** The text size of the cells. */
  size: number;
  minRowHeight: number;
}) {
  const border = 0.75;
  const cell = (j: number) => ({
    flexGrow: weights[j] ?? 1,
    flexShrink: 1,
    flexBasis: 0,
    borderWidth: border,
    borderColor: GRID,
    marginLeft: j === 0 ? 0 : -border,
    paddingHorizontal: 4,
    paddingVertical: 3,
  });
  const text = { fontSize: size, lineHeight: 1.35 };
  return (
    <View style={{ marginTop: s.gap }}>
      {caption ? <Title s={s} text={caption} factor={1} marginTop={0} /> : null}
      <View
        style={{ flexDirection: 'row', marginTop: caption ? s.size * 0.25 : 0 }}
        wrap={false}
        minPresenceAhead={minRowHeight || s.size * 3}
      >
        {header.map((h, j) => (
          <View key={j} style={[cell(j), { backgroundColor: HEAD }]}>
            <Text style={[text, s.bold]}>{pdfText(h)}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, i) => (
        <View
          key={i}
          style={{ flexDirection: 'row', marginTop: -border, minHeight: minRowHeight }}
          wrap={false}
        >
          {header.map((_, j) => {
            const value = row[j];
            return (
              <View key={j} style={cell(j)}>
                {typeof value === 'string' || value === undefined || value === null ? (
                  <Text style={text}>{pdfText(value ?? '')}</Text>
                ) : (
                  value
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------

function Leaf({ s, block }: { s: Sized; block: LeafBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <Title
          s={s}
          text={block.text}
          factor={block.level === 1 ? 1.35 : block.level === 2 ? 1.2 : 1.07}
          marginTop={s.gap + s.size * 0.4}
        />
      );
    case 'paragraph':
      return (
        <Text style={[s.body, { marginTop: s.gap }]} orphans={2} widows={2}>
          {pdfText(block.text)}
        </Text>
      );
    case 'list':
      return (
        <View style={{ marginTop: s.gap }}>
          {block.items.map((item, i) => (
            <Row key={i} s={s} marker={block.ordered ? `${i + 1}.` : '•'} first={i === 0}>
              <Text style={s.body}>{pdfText(item)}</Text>
            </Row>
          ))}
        </View>
      );
    case 'steps':
      return (
        <View style={{ marginTop: s.gap }}>
          {block.items.map((step, i) => (
            <Row key={i} s={s} marker={`${i + 1}.`} first={i === 0}>
              <Text style={s.body}>
                {step.minutes ? (
                  <Text style={[s.smallBody, s.muted]}>({L.minutes(step.minutes)}) </Text>
                ) : null}
                {pdfText(step.text)}
              </Text>
              {step.detail ? (
                <Text style={[s.smallBody, s.muted]}>{pdfText(step.detail)}</Text>
              ) : null}
            </Row>
          ))}
        </View>
      );
    case 'glossary':
      return (
        <View style={{ marginTop: s.gap }}>
          {block.entries.map((e, i) => (
            <Text key={i} style={[s.body, { marginTop: i === 0 ? 0 : s.size * 0.2 }]} wrap={false}>
              <Text style={s.bold}>{pdfText(e.term)}</Text>
              {e.definition ? `\u00a0: ${pdfText(e.definition)}` : ''}
            </Text>
          ))}
        </View>
      );
    case 'question':
      return <Question s={s} block={block} />;
    case 'table':
      return (
        <Grid
          s={s}
          caption={block.caption}
          header={block.columns}
          rows={block.rows}
          weights={block.columns.map(() => 1)}
          size={s.small}
          // Room to write in an empty observation table.
          minRowHeight={s.size * 2.2}
        />
      );
    case 'lines':
      return <WritingLines s={s} count={block.count} marginTop={s.gap} />;
    case 'nameLine':
      return (
        <View style={{ flexDirection: 'row', marginTop: s.gap }} wrap={false}>
          {block.labels.map((label, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                flexGrow: i === 0 ? 2 : 1,
                flexBasis: 0,
                marginLeft: i === 0 ? 0 : s.size * 1.5,
              }}
            >
              <Text style={{ fontSize: s.size }}>{pdfText(`${label}\u00a0:`)}</Text>
              <View
                style={{
                  flexGrow: 1,
                  marginLeft: s.size * 0.4,
                  height: s.size * 1.4,
                  borderBottomWidth: 0.75,
                  borderBottomColor: WRITING_LINE,
                }}
              />
            </View>
          ))}
        </View>
      );
    case 'callout': {
      const tone = TONES[block.tone] ?? TONES.info;
      const height =
        s.size * 3 +
        textHeight(block.text, s.size, DOC_TEXT_WIDTH - s.size * 2) +
        block.items.reduce(
          (h, item) => h + textHeight(item, s.size, DOC_TEXT_WIDTH - s.size * 3),
          0,
        );
      // A bar on the left rather than a frame: a long callout may run over to the next page.
      return (
        <View
          style={{
            backgroundColor: tone.background,
            borderLeftWidth: 3,
            borderLeftColor: tone.bar,
            paddingVertical: s.size * 0.5,
            paddingHorizontal: s.size * 0.75,
            marginTop: s.gap,
          }}
          wrap={height > KEEP_TOGETHER_HEIGHT}
        >
          <Text style={[s.body, s.bold]}>{pdfText(block.title)}</Text>
          {block.text ? <Text style={s.body}>{pdfText(block.text)}</Text> : null}
          {block.items.map((item, i) => (
            <Row key={i} s={s} marker="•" first={i === 0}>
              <Text style={s.body}>{pdfText(item)}</Text>
            </Row>
          ))}
        </View>
      );
    }
    case 'rubric': {
      // Five columns across the page: smaller print than the rest, whatever the document.
      const size = Math.min(s.small, 10);
      return (
        <Grid
          s={s}
          caption={block.caption}
          header={[L.criterion, ...block.levels]}
          rows={block.rows.map((row) => [
            <View key="criterion">
              <Text style={[{ fontSize: size * 0.9, lineHeight: 1.35 }, s.muted]}>
                {pdfText(row.category)}
              </Text>
              <Text style={[{ fontSize: size, lineHeight: 1.35 }, s.bold]}>
                {pdfText(row.criterion)}
              </Text>
            </View>,
            ...row.cells,
          ])}
          weights={[1.25, ...block.levels.map(() => 1)]}
          size={size}
          minRowHeight={0}
        />
      );
    }
    case 'answer': {
      const height =
        textHeight(block.text, s.size) +
        block.details.reduce((h, d) => h + textHeight(d, s.small), 0) +
        textHeight(block.explanation, s.small);
      const indent = { paddingLeft: s.size * 1.5 };
      return (
        <View style={{ marginTop: s.gap }} wrap={height > KEEP_TOGETHER_HEIGHT}>
          <Text style={s.body}>
            <Text style={s.bold}>{block.number}.</Text> {pdfText(block.text)}
          </Text>
          {block.details.map((d, i) => (
            <Text key={i} style={[s.smallBody, indent]}>
              {pdfText(d)}
            </Text>
          ))}
          {block.explanation ? (
            <Text style={[s.smallBody, s.muted, indent]}>
              {pdfText(labelled(L.explanation, block.explanation))}
            </Text>
          ) : null}
        </View>
      );
    }
    case 'poem':
      return (
        <View
          style={{ marginTop: s.gap }}
          wrap={textHeight(block.lines.join('\n'), s.size) + s.size * 2 > KEEP_TOGETHER_HEIGHT}
        >
          {block.title ? <Text style={[s.body, s.bold]}>{pdfText(block.title)}</Text> : null}
          <Text style={s.body}>{pdfText(block.lines.join('\n'))}</Text>
        </View>
      );
  }
}

/**
 * The blocks of a document, as siblings of what the caller puts before them, so that a heading
 * is kept with what follows it (React-PDF honours `minPresenceAhead` between siblings only).
 */
export function DocBlocks({ blocks, size }: { blocks: readonly DocBlock[]; size: number }) {
  const s = sized(size);
  return (
    <>
      {blocks.map((block, i) =>
        block.type === 'section' ? (
          // The English half of a family guide: its title, then its blocks (see the file comment).
          <SectionBlocks key={i} s={s} title={block.title} blocks={block.blocks} />
        ) : (
          <Leaf key={i} s={s} block={block} />
        ),
      )}
    </>
  );
}

function SectionBlocks({ s, title, blocks }: { s: Sized; title: string; blocks: LeafBlock[] }) {
  return (
    <>
      <Title s={s} text={title} factor={1.3} marginTop={s.gap + s.size * 0.6} />
      {blocks.map((b, i) => (
        <Leaf key={i} s={s} block={b} />
      ))}
    </>
  );
}

/**
 * A whole document: its title, its subtitle (the type, or the item's title on a key), then its
 * blocks. The small version number is the page's business (library-document.tsx).
 */
export function DocBody({
  doc,
  size = docBodySize(doc.kind),
}: {
  doc: RenderedDoc;
  size?: number;
}) {
  const s = sized(size);
  return (
    <>
      <Text
        style={{ fontSize: size * 1.6, lineHeight: 1.25, fontWeight: 700, color: INK }}
        minPresenceAhead={size * 4}
      >
        {pdfText(doc.title)}
      </Text>
      {doc.subtitle ? <Text style={[s.smallBody, s.muted]}>{pdfText(doc.subtitle)}</Text> : null}
      <DocBlocks blocks={doc.blocks} size={size} />
    </>
  );
}
