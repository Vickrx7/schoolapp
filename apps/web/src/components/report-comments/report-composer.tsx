'use client';

import { fillComment, plainSpaces, type ReportBankScope } from '@lynx/content';
import {
  commentStatus,
  emptyDraftStudent,
  resolveBankEntries,
  studentsWithWork,
  type BankEntry,
  type CodedExpectation,
  type ComposerReport,
  type LocalDate,
  type ReportDraftStudent,
} from '@lynx/domain';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Card } from '@/components/ui/card';
import { useReportDraft } from '@/hooks/use-report-draft';
import { cn } from '@/lib/utils';
import { ComposerSettings } from './composer-settings';
import { DeviceNotice } from './device-notice';
import { PrintSheet } from './print-sheet';
import { StudentEditor } from './student-editor';
import { StudentList } from './student-list';

export interface ComposerProps {
  userId: string;
  classId: string;
  today: LocalDate;
  /** The device draft's key (`reportDraftKey`). */
  draftKey: string;
  expiresOn: LocalDate;
  periodLabel: string;
  report: ComposerReport;
  subjectKey: string;
  subjectLabel: string;
  scope: ReportBankScope;
  /** Every subject's label, in the list's order (« Tout copier pour cet élève »). */
  subjectLabels: { key: string; label: string }[];
  students: { id: string; firstName: string }[];
  grades: { code: string; label: string }[];
  bank: { id: string; revision: number; entries: BankEntry[] } | null;
  expectations: CodedExpectation[];
  /** Null: no filter (the subject has no attentes loaded). */
  taughtIds: string[] | null;
  /** The page's heading (server-rendered). */
  heading: ReactNode;
  /** The filters, the bank and the taught attentes (server-rendered). */
  top: ReactNode;
  /** « Comment ça marche ». */
  help: ReactNode;
  /** No students yet. */
  empty: ReactNode;
}

const STUDENT_HASH = /^#eleve-([0-9a-f-]{36})$/i;

const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const DESKTOP = '(min-width: 768px)';
const subscribeDesktop = (onChange: () => void) => {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/**
 * « Bulletins » (DECISIONS D-130): the class's students and one student's comment at a time,
 * composed in the browser from the device draft (`useReportDraft`). The student shown is the
 * address's fragment (`#eleve-<id>`), which never leaves the browser: on a phone the list and the
 * student are two screens and Back returns to the list; on a larger screen they sit side by side.
 * Nothing here sends anything: no server action, no route handler, no form around a comment.
 */
export function ReportComposer(props: ComposerProps) {
  const { students, bank, subjectKey } = props;
  const state = useReportDraft({
    draftKey: props.draftKey,
    expiresOn: props.expiresOn,
    today: props.today,
    bank: useMemo(() => (bank ? { itemId: bank.id, revision: bank.revision } : null), [bank]),
  });
  const { draft, update } = state;

  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  );
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
  const hashId = STUDENT_HASH.exec(hash)?.[1]?.toLowerCase() ?? null;
  const selected = students.find((s) => s.id === hashId) ?? null;
  const shown = selected ?? (desktop ? (students[0] ?? null) : null);
  const index = shown ? students.indexOf(shown) : -1;

  // A student chosen from the list: Back on a phone returns to it; the student's name takes the
  // focus, so a screen reader starts there.
  const fromList = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [focusWanted, setFocusWanted] = useState(0);
  useEffect(() => {
    const onHash = () => setFocusWanted((n) => n + 1);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (focusWanted > 0 && STUDENT_HASH.test(window.location.hash)) heading.current?.focus();
  }, [focusWanted]);
  const backToList = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!fromList.current) return;
    event.preventDefault();
    fromList.current = false;
    window.history.back();
  };

  const parents = useMemo(
    () => new Map(props.expectations.map((e) => [e.id, e.parentId] as const)),
    [props.expectations],
  );
  const taught = useMemo(
    () => (props.taughtIds === null ? null : new Set(props.taughtIds)),
    [props.taughtIds],
  );
  const taughtFilter = taught && taught.size > 0 ? taught : null;
  const entriesByGrade = useMemo(
    () =>
      new Map(
        props.grades.map((g) => [
          g.code,
          resolveBankEntries(bank?.entries ?? [], {
            gradeCode: g.code,
            expectations: props.expectations,
          }),
        ]),
      ),
    [bank, props.expectations, props.grades],
  );
  const entriesFor = (gradeCode: string | null) =>
    entriesByGrade.get(gradeCode ?? '') ??
    resolveBankEntries(bank?.entries ?? [], { gradeCode, expectations: props.expectations });

  const shownId = shown?.id ?? null;
  const updateStudent = (change: (s: ReportDraftStudent) => ReportDraftStudent) => {
    if (!shownId) return;
    update((d) => ({
      ...d,
      students: { ...d.students, [shownId]: change(d.students[shownId] ?? emptyDraftStudent()) },
    }));
  };

  const rows = students.map((s) => ({
    ...s,
    status: commentStatus(draft.students[s.id]?.comments[subjectKey], s.firstName, draft.limit),
  }));
  const withText = students
    .map((s) => ({
      id: s.id,
      firstName: s.firstName,
      text: fillComment(draft.students[s.id]?.comments[subjectKey]?.text ?? '', s.firstName).trim(),
    }))
    .filter((s) => s.text);

  const [printing, setPrinting] = useState<string[]>([]);
  const print = (ids: string[]) => {
    flushSync(() => setPrinting(ids));
    window.print();
  };
  const sheets = withText.filter((s) => printing.includes(s.id));

  const copyAllText = () => {
    if (!shown) return '';
    const student = draft.students[shown.id];
    const parts = props.subjectLabels
      .map(({ key, label }) => {
        const text = fillComment(student?.comments[key]?.text ?? '', shown.firstName).trim();
        return text ? `${label}\n${text}` : null;
      })
      .filter(Boolean)
      .join('\n\n');
    return draft.plainSpaces ? plainSpaces(parts) : parts;
  };

  return (
    <>
      <div className="space-y-5 print:hidden">
        {props.heading}
        <DeviceNotice
          expiresOn={props.expiresOn}
          expired={state.expired}
          writeFailed={state.writeFailed}
          changedElsewhere={state.changedElsewhere}
        />
        {props.top}
        {students.length === 0 ? (
          props.empty
        ) : !state.loaded ? (
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" aria-hidden />
        ) : (
          <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-6">
            <div
              className={cn(
                'md:sticky md:top-20 md:max-h-[calc(100dvh-6rem)] md:overflow-y-auto',
                selected && 'hidden md:block',
              )}
            >
              <StudentList
                students={rows}
                currentId={shownId}
                limit={draft.limit}
                onPick={() => {
                  fromList.current = !desktop;
                }}
              />
            </div>
            <div className={cn(!selected && 'hidden md:block')}>
              {shown ? (
                <Card className="p-4 md:p-5">
                  <StudentEditor
                    key={shown.id}
                    student={shown}
                    draft={draft.students[shown.id] ?? emptyDraftStudent()}
                    subjectKey={subjectKey}
                    subjectLabel={props.subjectLabel}
                    scope={props.scope === 'learning_skills' ? 'learning_skills' : 'subject'}
                    report={props.report}
                    grades={props.grades}
                    bank={bank ? { itemId: bank.id, revision: bank.revision } : null}
                    entriesFor={entriesFor}
                    taught={taughtFilter}
                    parents={parents}
                    limit={draft.limit}
                    plainSpacesOnCopy={draft.plainSpaces}
                    update={updateStudent}
                    onPrint={() => print([shown.id])}
                    copyAllText={copyAllText}
                    previous={students[index - 1] ?? null}
                    next={students[index + 1] ?? null}
                    onBackToList={backToList}
                    headingRef={heading}
                  />
                </Card>
              ) : null}
            </div>
          </div>
        )}
        <ComposerSettings
          limit={draft.limit}
          plainSpaces={draft.plainSpaces}
          onLimit={(limit) => update((d) => (d.limit === limit ? d : { ...d, limit }))}
          onPlainSpaces={(on) => update((d) => ({ ...d, plainSpaces: on }))}
          printable={withText.length}
          onPrintAll={() => print(withText.map((s) => s.id))}
          studentsWithWork={studentsWithWork(draft).length}
          onClearAll={state.clear}
        />
        {props.help}
      </div>
      <PrintSheet
        sheets={sheets}
        subjectLabel={props.subjectLabel}
        periodLabel={props.periodLabel}
      />
    </>
  );
}
