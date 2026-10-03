/**
 * « Plan à long terme »'s layout (DECISIONS D-127): US Letter, Noto Sans. Page 1 is landscape,
 * the year at a glance (months across, the calendar, report dates, seasons and subjects down);
 * then portrait pages with the units by subject and their attentes; then, only when asked,
 * « Couverture des attentes ». A footer on every page names the document and its page, and says
 * that attentes « à vérifier » are summaries when one is printed. year-plan-model.ts decides what
 * is printed; this file only lays it out.
 *
 * Plain function components without hooks: React-PDF renders them with its own reconciler.
 * Not server-only, so the renderer can be unit tested; only route handlers import it.
 */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { APP_NAME } from '../../lib/app-name';
import { PDF_FONT_FAMILY } from './fonts';
import type {
  YearPlanPdfCellItem,
  YearPlanPdfModel,
  YearPlanPdfRow,
  YearPlanPdfSection,
  YearPlanPdfUnitEntry,
} from './year-plan-model';

// Tailwind's slate, as on screen.
const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#64748b';
const RULE = '#cbd5e1';
const PANEL = '#f1f5f9';
const BRAND = '#1d4ed8';

/** Letter, landscape: 792 × 612 pt; the margins leave 736 pt across. */
const LANDSCAPE_WIDTH = 792;
const MARGIN = 28;
const LABEL_WIDTH = 78;

const styles = StyleSheet.create({
  // Line heights are set on each text and box, never on the page: an inherited line height makes
  // React-PDF drop the fixed footer (plan-document.tsx). Font size and line height go together.
  landscape: {
    fontFamily: PDF_FONT_FAMILY,
    color: INK,
    paddingTop: 26,
    paddingBottom: 44,
    paddingHorizontal: MARGIN,
  },
  portrait: {
    fontFamily: PDF_FONT_FAMILY,
    color: INK,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 44,
  },
  header: {
    borderBottomWidth: 1.5,
    borderBottomColor: INK,
    paddingBottom: 5,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  headerMain: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 12 },
  headerSide: { width: 380, textAlign: 'right' },
  school: { fontSize: 8, lineHeight: 1.3, color: MUTED },
  title: { fontSize: 16, lineHeight: 1.2, fontWeight: 700 },
  subtitle: { fontSize: 10, lineHeight: 1.3, fontWeight: 700 },
  headerLine: { fontSize: 8, lineHeight: 1.35, color: MUTED },
  glanceTitle: { fontSize: 9, lineHeight: 1.3, fontWeight: 700, color: MUTED, marginBottom: 3 },
  // The year at a glance.
  table: {
    borderTopWidth: 0.75,
    borderTopColor: RULE,
    borderLeftWidth: 0.75,
    borderLeftColor: RULE,
  },
  tr: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: RULE },
  th: {
    borderRightWidth: 0.75,
    borderRightColor: RULE,
    paddingVertical: 3,
    paddingHorizontal: 3,
    backgroundColor: PANEL,
  },
  td: {
    borderRightWidth: 0.75,
    borderRightColor: RULE,
    paddingVertical: 2.5,
    paddingHorizontal: 3,
  },
  calendarCell: { backgroundColor: '#f8fafc' },
  monthLabel: { fontSize: 8, lineHeight: 1.25, fontWeight: 700 },
  monthDays: { fontSize: 6.5, lineHeight: 1.25, color: MUTED },
  rowLabel: { fontSize: 7.5, lineHeight: 1.25, fontWeight: 700 },
  rowLabelMuted: { fontSize: 7, lineHeight: 1.25, fontWeight: 700, color: MUTED },
  item: { marginBottom: 2 },
  itemText: { fontSize: 6.5, lineHeight: 1.25 },
  unitText: { fontSize: 7, lineHeight: 1.25, fontWeight: 700 },
  itemDetail: { fontSize: 6.5, lineHeight: 1.25, color: MUTED },
  legend: { fontSize: 7, lineHeight: 1.3, color: MUTED, marginTop: 4 },
  // The units by subject.
  pageTitle: {
    fontSize: 16,
    lineHeight: 1.25,
    fontWeight: 700,
    borderBottomWidth: 1.5,
    borderBottomColor: INK,
    paddingBottom: 5,
    marginBottom: 6,
  },
  subject: {
    fontSize: 13,
    lineHeight: 1.3,
    fontWeight: 700,
    color: BRAND,
    marginTop: 10,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    paddingBottom: 2,
  },
  unit: { marginBottom: 8, borderLeftWidth: 2, borderLeftColor: RULE, paddingLeft: 8 },
  unitTitle: { fontSize: 11, lineHeight: 1.3, fontWeight: 700 },
  unitMeta: { fontSize: 9, lineHeight: 1.35, color: MUTED },
  label: { fontSize: 9, lineHeight: 1.35, fontWeight: 700, color: MUTED, marginTop: 3 },
  expectation: { flexDirection: 'row', fontSize: 9, lineHeight: 1.35, marginBottom: 1 },
  code: { width: 40, fontWeight: 700 },
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  note: { fontSize: 9, lineHeight: 1.35, color: MUTED },
  body: { fontSize: 10, lineHeight: 1.4, marginBottom: 8 },
  // « Couverture des attentes »
  coverageRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.75,
    borderBottomColor: RULE,
    paddingVertical: 4,
    fontSize: 10,
    lineHeight: 1.35,
  },
  coverageHead: { fontWeight: 700, backgroundColor: PANEL },
  coverageNumber: { width: 74, textAlign: 'right', paddingRight: 6 },
  footer: {
    position: 'absolute',
    left: MARGIN,
    right: MARGIN,
    bottom: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 4,
    fontSize: 7.5,
    color: FAINT,
  },
  footerPortrait: { left: 44, right: 44, bottom: 28 },
  footerText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 12 },
  // A fixed width: the page count is laid out before the total is known.
  pageNumber: { width: 80, textAlign: 'right' },
});

function Footer({ model, portrait }: { model: YearPlanPdfModel; portrait: boolean }) {
  const { footer } = model;
  return (
    <View style={portrait ? [styles.footer, styles.footerPortrait] : styles.footer} fixed>
      <Text style={styles.footerText}>
        {footer.note ? `${footer.left} · ${footer.note}` : footer.left}
      </Text>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => footer.page(pageNumber, totalPages)}
      />
    </View>
  );
}

function Items({ items, unit }: { items: YearPlanPdfCellItem[]; unit: boolean }) {
  return (
    <>
      {items.map((item, i) => (
        <View key={i} style={styles.item}>
          <Text style={unit ? styles.unitText : styles.itemText}>{item.text}</Text>
          {item.detail ? <Text style={styles.itemDetail}>{item.detail}</Text> : null}
        </View>
      ))}
    </>
  );
}

function GlanceRow({ row, width }: { row: YearPlanPdfRow; width: number }) {
  const subject = row.kind === 'subject';
  return (
    <View style={styles.tr} wrap={false}>
      <View
        style={subject ? [styles.td, { width: LABEL_WIDTH }] : [styles.th, { width: LABEL_WIDTH }]}
      >
        <Text style={subject ? styles.rowLabel : styles.rowLabelMuted}>{row.label}</Text>
      </View>
      {row.cells.map((items, i) => (
        <View
          key={i}
          style={subject ? [styles.td, { width }] : [styles.td, styles.calendarCell, { width }]}
        >
          <Items items={items} unit={subject} />
        </View>
      ))}
    </View>
  );
}

function Glance({ model }: { model: YearPlanPdfModel }) {
  const { glance } = model;
  const width =
    (LANDSCAPE_WIDTH - 2 * MARGIN - LABEL_WIDTH - 1) / Math.max(1, glance.months.length);
  return (
    <>
      <Text style={styles.glanceTitle}>{glance.title}</Text>
      <View style={styles.table}>
        <View style={styles.tr} wrap={false}>
          <View style={[styles.th, { width: LABEL_WIDTH }]}>
            <Text style={styles.monthLabel}>{glance.subjectLabel}</Text>
          </View>
          {glance.months.map((m) => (
            <View key={m.key} style={[styles.th, { width }]}>
              <Text style={styles.monthLabel}>{m.label}</Text>
              <Text style={styles.monthDays}>{m.days}</Text>
            </View>
          ))}
        </View>
        {glance.rows.map((row, i) => (
          <GlanceRow key={`${row.kind}-${i}`} row={row} width={width} />
        ))}
      </View>
      {glance.legend ? <Text style={styles.legend}>{glance.legend}</Text> : null}
    </>
  );
}

/** A unit: its title and dates kept together, then its attentes (a long list flows over). */
function Unit({ unit, label, none }: { unit: YearPlanPdfUnitEntry; label: string; none: string }) {
  return (
    <View style={styles.unit}>
      <View wrap={false} minPresenceAhead={36}>
        <Text style={styles.unitTitle}>{unit.title}</Text>
        <Text style={styles.unitMeta}>
          {unit.when} · {unit.length}
        </Text>
        {unit.inferred ? <Text style={styles.unitMeta}>{unit.inferred}</Text> : null}
        <Text style={styles.label}>{label}</Text>
        {unit.expectations.length === 0 ? <Text style={styles.note}>{none}</Text> : null}
      </View>
      {unit.expectations.map((e, i) => (
        <View key={i} style={styles.expectation} wrap={false}>
          <Text style={styles.code}>{e.code}</Text>
          <Text style={styles.grow}>
            {e.text}
            {e.toVerify ? ` (${e.toVerify})` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Siblings of what comes before, so a subject's name is never left alone at a page's foot. */
function Section({ model, section }: { model: YearPlanPdfModel; section: YearPlanPdfSection }) {
  return (
    <>
      <Text style={styles.subject} minPresenceAhead={60} wrap={false}>
        {section.subject}
      </Text>
      {section.units.map((u) => (
        <Unit
          key={u.key}
          unit={u}
          label={model.bySubject.expectationsLabel}
          none={model.bySubject.noExpectations}
        />
      ))}
      {section.outsideYear ? (
        <>
          <Text style={styles.note} minPresenceAhead={40}>
            {section.outsideYear.title}
          </Text>
          {section.outsideYear.units.map((u) => (
            <Unit
              key={u.key}
              unit={u}
              label={model.bySubject.expectationsLabel}
              none={model.bySubject.noExpectations}
            />
          ))}
        </>
      ) : null}
      {section.unplaced ? <Text style={styles.note}>{section.unplaced}</Text> : null}
    </>
  );
}

export function YearPlanDocument({ model }: { model: YearPlanPdfModel }) {
  return (
    <Document
      title={model.info.title}
      language={model.info.language}
      creator={APP_NAME}
      producer={APP_NAME}
    >
      <Page size="LETTER" orientation="landscape" style={styles.landscape}>
        <Footer model={model} portrait={false} />
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Text style={styles.school}>{model.header.school}</Text>
            <Text style={styles.title}>{model.header.title}</Text>
            <Text style={styles.subtitle}>{model.header.subtitle}</Text>
          </View>
          <View style={styles.headerSide}>
            {model.header.lines.map((line, i) => (
              <Text key={i} style={styles.headerLine}>
                {line}
              </Text>
            ))}
          </View>
        </View>
        <Glance model={model} />
      </Page>

      <Page size="LETTER" style={styles.portrait}>
        <Footer model={model} portrait />
        <Text style={styles.pageTitle}>{model.bySubject.title}</Text>
        {model.bySubject.empty ? <Text style={styles.body}>{model.bySubject.empty}</Text> : null}
        {model.bySubject.sections.map((s) => (
          <Section key={s.key} model={model} section={s} />
        ))}
      </Page>

      {model.coverage ? (
        <Page size="LETTER" style={styles.portrait}>
          <Footer model={model} portrait />
          <Text style={styles.pageTitle}>{model.coverage.title}</Text>
          <Text style={styles.body}>{model.coverage.intro}</Text>
          {model.coverage.rows.length ? (
            <View>
              <View style={[styles.coverageRow, styles.coverageHead]} wrap={false}>
                {model.coverage.columns.map((c, i) => (
                  <Text key={i} style={i === 0 ? styles.grow : styles.coverageNumber}>
                    {c}
                  </Text>
                ))}
              </View>
              {model.coverage.rows.map((r) => (
                <View key={r.key} style={styles.coverageRow} wrap={false}>
                  <Text style={styles.grow}>{r.label}</Text>
                  {r.values.map((v, i) => (
                    <Text key={i} style={styles.coverageNumber}>
                      {v}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
          {model.coverage.notes.map((n, i) => (
            <Text key={i} style={[styles.note, { marginTop: 8 }]}>
              {n}
            </Text>
          ))}
        </Page>
      ) : null}
    </Document>
  );
}
