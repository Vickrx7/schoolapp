/**
 * The plan PDF's layout (DECISIONS D-053): US Letter, Noto Sans, the header, the alerts notice,
 * then each section of the model (model.ts decides what is printed; this file only lays it out).
 * A footer on every page says the document is confidential and goes back to the office.
 *
 * Plain function components without hooks: React-PDF renders them with its own reconciler.
 * Not server-only, so the renderer can be unit tested; only route handlers import it.
 */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { APP_NAME } from '../../lib/app-name';
import { PDF_FONT_FAMILY } from './fonts';
import type { PdfPart, PlanPdfBlock, PlanPdfModel, PlanPdfSection } from './model';

// Tailwind's slate and amber, as on screen.
const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#64748b';
const RULE = '#cbd5e1';
const PANEL = '#f8fafc';

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
    color: INK,
    paddingTop: 40,
    paddingBottom: 64,
    paddingHorizontal: 44,
  },
  // Line heights are set on each text and box, never on the page: an inherited line height makes
  // React-PDF drop the fixed footer. A line height is only right next to its font size (without
  // one, React-PDF resolves it against its 18 pt default), so both are always set together.
  header: {
    fontSize: 10,
    lineHeight: 1.4,
    borderBottomWidth: 1.5,
    borderBottomColor: INK,
    paddingBottom: 8,
    marginBottom: 10,
  },
  school: { fontSize: 9, lineHeight: 1.3, color: MUTED },
  title: { fontSize: 18, lineHeight: 1.25, fontWeight: 700, marginTop: 2 },
  heading: { fontSize: 13, lineHeight: 1.3, fontWeight: 700, marginTop: 2 },
  headerLine: { color: MUTED },
  alerts: {
    borderWidth: 1.5,
    borderColor: '#d97706',
    backgroundColor: '#fffbeb',
    color: '#78350f',
    fontWeight: 700,
    fontSize: 10,
    lineHeight: 1.4,
    padding: 8,
    marginVertical: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 1.3,
    fontWeight: 700,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    paddingBottom: 2,
    marginBottom: 6,
  },
  subheading: { fontSize: 11, lineHeight: 1.3, fontWeight: 700, marginTop: 6, marginBottom: 2 },
  partEnd: { fontSize: 10, lineHeight: 1.4, marginBottom: 5 },
  label: { fontSize: 10, lineHeight: 1.4, fontWeight: 700, color: MUTED },
  row: { fontSize: 10, lineHeight: 1.4, flexDirection: 'row' },
  // A zero basis: a text in a row wraps to the space left instead of overflowing it.
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  bullet: { width: 12 },
  // No top or bottom border or padding on a block: React-PDF can push a whole block to the next
  // page when only its bottom edge would not fit. A rule on the left marks the block instead.
  block: {
    fontSize: 10,
    lineHeight: 1.4,
    borderLeftWidth: 2,
    borderLeftColor: RULE,
    paddingLeft: 8,
    marginBottom: 12,
  },
  blockHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: PANEL,
    paddingVertical: 3,
    paddingHorizontal: 5,
    marginBottom: 4,
  },
  blockTime: { fontWeight: 700, width: 116 },
  blockTitle: {
    fontWeight: 700,
    fontSize: 11,
    lineHeight: 1.3,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  tags: { color: MUTED, fontSize: 9, lineHeight: 1.3, width: '100%', paddingLeft: 116 },
  event: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 3,
    padding: 5,
    marginBottom: 5,
  },
  lessonHeading: { fontSize: 8.5, lineHeight: 1.4, color: FAINT, textTransform: 'uppercase' },
  lessonTitle: { fontWeight: 700, marginBottom: 3 },
  gap: { color: '#92400e', marginBottom: 3 },
  stepMinutes: { width: 44, color: FAINT },
  say: { color: MUTED },
  group: {
    fontSize: 10,
    lineHeight: 1.4,
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 3,
    padding: 6,
    marginBottom: 5,
    backgroundColor: PANEL,
  },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between' },
  small: { fontSize: 8.5, lineHeight: 1.4, color: FAINT },
  footer: {
    position: 'absolute',
    left: 44,
    right: 44,
    bottom: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 4,
    fontSize: 8,
    color: FAINT,
  },
  footerText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 12 },
  // A fixed width: the page count is laid out before the total is known.
  pageNumber: { width: 80, textAlign: 'right' },
});

/**
 * A label and its text are siblings (not wrapped in a view) so that the label is never left
 * alone at the bottom of a page: React-PDF honours `minPresenceAhead` only between siblings, and
 * only for a text that cannot itself be split (`wrap={false}`).
 */
function Part({ part }: { part: PdfPart }) {
  const label = (text: string | null) =>
    text ? (
      <Text style={styles.label} minPresenceAhead={28} wrap={false}>
        {text}
      </Text>
    ) : null;
  switch (part.kind) {
    case 'heading':
      return (
        <Text style={styles.subheading} minPresenceAhead={40} wrap={false}>
          {part.text}
        </Text>
      );
    case 'text':
      return (
        <>
          {label(part.label)}
          <Text style={styles.partEnd}>{part.text}</Text>
        </>
      );
    case 'list':
      return (
        <>
          {label(part.label)}
          {part.items.map((item, i) => (
            <View
              key={i}
              style={i === part.items.length - 1 ? [styles.row, styles.partEnd] : styles.row}
              wrap={false}
            >
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.grow}>{item}</Text>
            </View>
          ))}
        </>
      );
    case 'group':
      return (
        <View style={styles.group} wrap={false}>
          <View style={styles.groupHead}>
            <Text style={styles.label}>{part.title}</Text>
            <Text style={styles.small}>{part.meta}</Text>
          </View>
          <Text>{part.names}</Text>
          {part.description ? <Text style={styles.small}>{part.description}</Text> : null}
        </View>
      );
  }
}

function Parts({ parts }: { parts: PdfPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Part key={i} part={p} />
      ))}
    </>
  );
}

/** About how many lines a text takes at 10 pt across the page (95 characters a line). */
const lines = (text: string | null) =>
  text ? text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 95)), 0) : 0;
const partLines = (parts: PdfPart[]) =>
  parts.reduce(
    (n, p) =>
      n +
      (p.kind === 'text'
        ? 1 + lines(p.text)
        : p.kind === 'list'
          ? 1 + p.items.reduce((m, i) => m + lines(i), 0)
          : 3),
    0,
  );

/** A short block (a routine, an event, a handover) is never split between two pages. */
function keptTogether(block: PlanPdfBlock): boolean {
  const total =
    3 +
    lines(block.event?.notes ?? null) +
    partLines(block.details) +
    block.steps.reduce((n, s) => n + lines(s.text) + lines(s.say), 1) +
    partLines(block.extras);
  return total <= 16;
}

function Block({ block, stepsLabel }: { block: PlanPdfBlock; stepsLabel: string }) {
  return (
    <View style={styles.block} wrap={!keptTogether(block)}>
      {/* When, what, where and the lesson's title stay together. */}
      <View wrap={false}>
        <View style={styles.blockHead}>
          <Text style={styles.blockTime}>{block.time}</Text>
          <Text style={styles.blockTitle}>{block.title}</Text>
          {block.tags.length > 0 ? <Text style={styles.tags}>{block.tags.join(' · ')}</Text> : null}
        </View>
        {block.otherAdult ? <Text style={styles.partEnd}>{block.otherAdult}</Text> : null}
        {block.event ? (
          <View style={styles.event}>
            <Text style={styles.label}>{block.event.title}</Text>
            {block.event.notes ? <Text>{block.event.notes}</Text> : null}
          </View>
        ) : null}
        {block.lesson ? (
          <>
            <Text style={styles.lessonHeading}>{block.lesson.heading}</Text>
            <Text style={styles.lessonTitle}>{block.lesson.title}</Text>
            {block.lesson.gap ? <Text style={styles.gap}>{block.lesson.gap}</Text> : null}
          </>
        ) : null}
      </View>
      <Parts parts={block.details} />
      {block.steps.length > 0 ? (
        <>
          <Text style={styles.label} minPresenceAhead={28} wrap={false}>
            {stepsLabel}
          </Text>
          {block.steps.map((s, i) => (
            <View
              key={i}
              style={i === block.steps.length - 1 ? [styles.row, styles.partEnd] : styles.row}
              wrap={false}
            >
              <Text style={styles.stepMinutes}>{s.minutes ?? '•'}</Text>
              <View style={styles.grow}>
                <Text>{s.text}</Text>
                {s.say ? <Text style={styles.say}>{s.say}</Text> : null}
              </View>
            </View>
          ))}
        </>
      ) : null}
      <Parts parts={block.extras} />
    </View>
  );
}

/** Siblings of what comes before, so a title is never left alone at the bottom of a page. */
function Section({ section, stepsLabel }: { section: PlanPdfSection; stepsLabel: string }) {
  return (
    <>
      <Text style={styles.sectionTitle} minPresenceAhead={48} wrap={false}>
        {section.title}
      </Text>
      <Parts parts={section.parts} />
      {section.blocks.map((b) => (
        <Block key={b.key} block={b} stepsLabel={stepsLabel} />
      ))}
    </>
  );
}

export function PlanDocument({ model }: { model: PlanPdfModel }) {
  return (
    <Document
      title={model.info.title}
      language={model.info.language}
      creator={APP_NAME}
      producer={APP_NAME}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{model.footer.confidential}</Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => model.footer.page(pageNumber, totalPages)}
          />
        </View>

        <View style={styles.header}>
          <Text style={styles.school}>{model.header.schoolName}</Text>
          <Text style={styles.title}>{model.header.title}</Text>
          <Text style={styles.heading}>{model.header.heading}</Text>
          {model.header.lines.map((line, i) => (
            <Text key={i} style={styles.headerLine}>
              {line}
            </Text>
          ))}
        </View>

        <Parts parts={model.intro} />
        <Text style={styles.alerts}>{model.alertsNotice}</Text>

        {model.sections.map((s) => (
          <Section key={s.id} section={s} stepsLabel={model.stepsLabel} />
        ))}
      </Page>
    </Document>
  );
}
