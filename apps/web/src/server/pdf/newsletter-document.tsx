/**
 * An « Info-parents » PDF's layout (DECISIONS D-141): US Letter, portrait, Noto Sans; one page per
 * language when the message fits (the body size steps down from 11.5 to 10 points for a longer
 * message, `renderNewsletterPdf`), flowing onto more pages otherwise, a page's number shown only
 * then. Each language's pages have the school, « Info-parents » and the class at the top with the
 * week beside them, then the sections: the greeting and the teacher's paragraphs, each list
 * section under its heading with a bullet per line, the « Moment de foi » in a soft box, the
 * closing and the signature kept together. A heading is never left alone at a page's foot, a
 * bullet line never split. On the English page, a paragraph still in French is set in a muted
 * colour and marked « (in French) » (there is no italic face, fonts.ts). newsletter-model.ts
 * decides what is printed; this file only lays it out.
 *
 * Plain function components without hooks: React-PDF renders them with its own reconciler.
 * Not server-only, so the renderer can be unit tested; only route handlers import it.
 */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { APP_NAME } from '../../lib/app-name';
import { PDF_FONT_FAMILY } from './fonts';
import type {
  NewsletterPdfModel,
  NewsletterPdfPage,
  NewsletterPdfParagraph,
  NewsletterPdfSection,
} from './newsletter-model';

// Tailwind's slate, brand and violet, as on screen and in the other PDFs.
const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#64748b';
const RULE = '#cbd5e1';
const BRAND = '#1d4ed8';
const FAITH = { bar: '#a78bfa', background: '#f5f3ff', heading: '#5b21b6' };

/** US Letter in points, and the page's margins. */
export const NEWSLETTER_PAGE = { width: 612, height: 792, top: 36, bottom: 52, side: 54 };
const TEXT_WIDTH = NEWSLETTER_PAGE.width - 2 * NEWSLETTER_PAGE.side;
/** Body sizes from the largest down: the first one that keeps each language on one page. */
export const NEWSLETTER_BODY_SIZES = [11.5, 11, 10.5, 10] as const;
/** Line height of body text (a multiple of the font size, always set next to it). */
const LINE = 1.38;
const HEADING_RATIO = 1.18;
const BULLET_WIDTH = 1.1;
const FAITH_BAR = 3;

const HEADER = {
  school: { fontSize: 9.5, lineHeight: 1.3 },
  title: { fontSize: 22, lineHeight: 1.15 },
  className: { fontSize: 12.5, lineHeight: 1.3, marginTop: 2 },
  paddingBottom: 8,
  rule: 2.5,
};

const styles = StyleSheet.create({
  // As in the other documents, a line height is set on each text, never on the page: an inherited
  // line height makes React-PDF drop the fixed footer (plan-document.tsx).
  page: {
    fontFamily: PDF_FONT_FAMILY,
    color: INK,
    paddingTop: NEWSLETTER_PAGE.top,
    paddingBottom: NEWSLETTER_PAGE.bottom,
    paddingHorizontal: NEWSLETTER_PAGE.side,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: HEADER.rule,
    borderBottomColor: BRAND,
    paddingBottom: HEADER.paddingBottom,
  },
  headerMain: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 16 },
  school: { ...HEADER.school, fontWeight: 700, color: MUTED },
  title: { ...HEADER.title, fontWeight: 700, color: BRAND },
  className: { ...HEADER.className, fontWeight: 700 },
  week: { fontSize: 11.5, lineHeight: 1.3, fontWeight: 700, textAlign: 'right', maxWidth: 190 },
  bulletRow: { flexDirection: 'row' },
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  faith: {
    backgroundColor: FAITH.background,
    borderLeftWidth: FAITH_BAR,
    borderLeftColor: FAITH.bar,
    borderRadius: 3,
  },
  inFrench: { color: MUTED },
  signature: { fontWeight: 700 },
  footer: {
    position: 'absolute',
    left: NEWSLETTER_PAGE.side,
    right: NEWSLETTER_PAGE.side,
    bottom: 20,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  footerText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    paddingRight: 12,
    fontSize: 7.5,
    lineHeight: 1.35,
    color: FAINT,
  },
  footerNote: { fontSize: 7.5, lineHeight: 1.35, color: MUTED },
  // A fixed width: the page count is laid out before the total is known. No line height: with
  // one, React-PDF drops a text drawn by `render`.
  pageNumber: { width: 80, textAlign: 'right', fontSize: 7.5, color: FAINT },
});

/** The text sizes and spaces of one body size. */
function metrics(size: number) {
  return {
    body: { fontSize: size, lineHeight: LINE },
    heading: { fontSize: size * HEADING_RATIO, lineHeight: 1.3, fontWeight: 700 },
    label: { fontSize: size * 0.85, lineHeight: LINE },
    /** Above a section, a paragraph, a bullet line, the signature. */
    sectionGap: size * 1.05,
    paragraphGap: size * 0.5,
    bulletGap: size * 0.25,
    headingGap: size * 0.2,
    faithPadding: { vertical: size * 0.6, horizontal: size },
  };
}

// ---------------------------------------------------------------------------------------
// How tall a page is (to choose the body size)
// ---------------------------------------------------------------------------------------

/**
 * About how many lines a text takes at `size` across `width`: Noto Sans averages a little under
 * half an em per character, so this errs on the side of more lines.
 */
function lineCount(text: string, size: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

const HEADER_HEIGHT =
  HEADER.school.fontSize * HEADER.school.lineHeight +
  HEADER.title.fontSize * HEADER.title.lineHeight +
  HEADER.className.fontSize * HEADER.className.lineHeight +
  HEADER.className.marginTop +
  HEADER.paddingBottom +
  HEADER.rule;

/** About how tall a page's content is at body size `size`, in points. */
export function newsletterPageHeight(page: NewsletterPdfPage, size: number): number {
  const m = metrics(size);
  const lines = (p: NewsletterPdfParagraph, width: number) =>
    lineCount(p.inFrench ? `${p.text} ${page.inFrenchLabel}` : p.text, size, width) * size * LINE;
  const heading = (text: string, width: number) =>
    lineCount(text, m.heading.fontSize, width) * m.heading.fontSize * m.heading.lineHeight +
    m.headingGap;
  let height = HEADER_HEIGHT;
  for (const section of page.sections) {
    height += m.sectionGap;
    if (section.style === 'faith') {
      const inner = TEXT_WIDTH - FAITH_BAR - 2 * m.faithPadding.horizontal;
      height += 2 * m.faithPadding.vertical;
      if (section.heading) height += heading(section.heading, inner);
      height += section.paragraphs.reduce((h, p) => h + lines(p, inner), 0);
      height += (section.paragraphs.length - 1) * m.paragraphGap;
      continue;
    }
    if (section.heading) height += heading(section.heading, TEXT_WIDTH);
    const width = section.style === 'list' ? TEXT_WIDTH - size * BULLET_WIDTH : TEXT_WIDTH;
    const gap = section.style === 'list' ? m.bulletGap : m.paragraphGap;
    height += section.paragraphs.reduce((h, p, i) => h + lines(p, width) + (i ? gap : 0), 0);
  }
  if (page.signature)
    height += m.sectionGap + lineCount(page.signature, size, TEXT_WIDTH) * size * LINE;
  return height;
}

/** The room for a page's content. */
export const NEWSLETTER_PAGE_ROOM =
  NEWSLETTER_PAGE.height - NEWSLETTER_PAGE.top - NEWSLETTER_PAGE.bottom;

// ---------------------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------------------

function Paragraph({
  paragraph,
  label,
  size,
  style,
}: {
  paragraph: NewsletterPdfParagraph;
  label: string;
  size: number;
  style?: { marginTop?: number };
}) {
  const m = metrics(size);
  if (!paragraph.inFrench) return <Text style={[m.body, style ?? {}]}>{paragraph.text}</Text>;
  return (
    <Text style={[m.body, styles.inFrench, style ?? {}]}>
      {paragraph.text} <Text style={[m.label, { color: FAINT }]}>{label}</Text>
    </Text>
  );
}

function Section({
  page,
  section,
  size,
}: {
  page: NewsletterPdfPage;
  section: NewsletterPdfSection;
  size: number;
}) {
  const m = metrics(size);
  const label = page.inFrenchLabel;
  if (section.style === 'faith') {
    return (
      <View
        style={[
          styles.faith,
          {
            marginTop: m.sectionGap,
            paddingVertical: m.faithPadding.vertical,
            paddingHorizontal: m.faithPadding.horizontal,
          },
        ]}
        wrap={false}
      >
        {section.heading ? (
          <Text style={[m.heading, { color: FAITH.heading, marginBottom: m.headingGap }]}>
            {section.heading}
          </Text>
        ) : null}
        {section.paragraphs.map((p, i) => (
          <Paragraph
            key={i}
            paragraph={p}
            label={label}
            size={size}
            style={i ? { marginTop: m.paragraphGap } : {}}
          />
        ))}
      </View>
    );
  }
  const heading = section.heading ? (
    <Text
      style={[m.heading, { color: BRAND, marginTop: m.sectionGap, marginBottom: m.headingGap }]}
      minPresenceAhead={size * LINE * 2}
    >
      {section.heading}
    </Text>
  ) : null;
  if (section.style === 'list') {
    return (
      <>
        {heading}
        {section.paragraphs.map((p, i) => (
          <View
            key={i}
            style={[styles.bulletRow, { marginTop: i ? m.bulletGap : heading ? 0 : m.sectionGap }]}
            wrap={false}
          >
            <Text style={[m.body, { width: size * BULLET_WIDTH, color: BRAND }]}>•</Text>
            <View style={styles.grow}>
              <Paragraph paragraph={p} label={label} size={size} />
            </View>
          </View>
        ))}
      </>
    );
  }
  return (
    <>
      {heading}
      {section.paragraphs.map((p, i) => (
        <Paragraph
          key={i}
          paragraph={p}
          label={label}
          size={size}
          style={{ marginTop: i ? m.paragraphGap : heading ? 0 : m.sectionGap }}
        />
      ))}
    </>
  );
}

function LanguagePage({ page, size }: { page: NewsletterPdfPage; size: number }) {
  const m = metrics(size);
  // The closing and the signature stay together, at the end.
  const last = page.sections.at(-1);
  const closing = last?.key === 'closing' ? last : null;
  const sections = closing ? page.sections.slice(0, -1) : page.sections;
  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.footer} fixed>
        <View style={styles.footerText}>
          {page.note ? <Text style={styles.footerNote}>{page.note}</Text> : null}
          <Text>{page.footer}</Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ subPageNumber, subPageTotalPages }) =>
            subPageTotalPages > 1 ? page.page(subPageNumber, subPageTotalPages) : ''
          }
        />
      </View>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <Text style={styles.school}>{page.header.school}</Text>
          <Text style={styles.title}>{page.header.title}</Text>
          <Text style={styles.className}>{page.header.className}</Text>
        </View>
        <Text style={styles.week}>{page.header.week}</Text>
      </View>
      {sections.map((section) => (
        <Section key={section.key} page={page} section={section} size={size} />
      ))}
      {closing || page.signature ? (
        <View wrap={false}>
          {closing ? <Section page={page} section={closing} size={size} /> : null}
          {page.signature ? (
            <Text style={[m.body, styles.signature, { marginTop: m.sectionGap }]}>
              {page.signature}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Page>
  );
}

export function NewsletterDocument({ model, size }: { model: NewsletterPdfModel; size: number }) {
  return (
    <Document
      title={model.info.title}
      language={model.info.language}
      creator={APP_NAME}
      producer={APP_NAME}
    >
      {model.pages.map((page) => (
        <LanguagePage key={page.lang} page={page} size={size} />
      ))}
    </Document>
  );
}
