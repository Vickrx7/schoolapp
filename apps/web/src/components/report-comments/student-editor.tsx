'use client';

import { COMMENT_FORMS, fillComment, unfillComment, type CommentForm } from '@lynx/content';
import {
  composeFromPicks,
  emptyDraftComment,
  suggestEntries,
  type ComposerReport,
  type ReportDraftComment,
  type ReportDraftStudent,
  type ResolvedEntry,
} from '@lynx/domain';
import { ChevronLeft, ChevronRight, ClipboardCopy, Printer, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea } from '@/components/ui/field';
import { CommentField } from './comment-field';
import { copyText } from './copy';
import { EntryPicker } from './entry-picker';
import { MarkFields } from './mark-fields';
import { Segmented } from './segmented';

export interface EditorStudent {
  id: string;
  firstName: string;
}

/**
 * One student's comment for the chosen subject (DECISIONS D-130): « Formulation », « Année
 * d'études » (a combined class), the mark, the bank's entries to tick, « Commentaire » with its
 * counter and « Copier », then « Mes notes (sur cet appareil) ». Everything stays in the page and
 * the device draft; nothing here sends anything.
 */
export function StudentEditor({
  student,
  draft,
  subjectKey,
  subjectLabel,
  scope,
  report,
  grades,
  bank,
  entriesFor,
  taught,
  parents,
  limit,
  plainSpacesOnCopy,
  update,
  onPrint,
  copyAllText,
  previous,
  next,
  onBackToList,
  headingRef,
}: {
  student: EditorStudent;
  draft: ReportDraftStudent;
  subjectKey: string;
  subjectLabel: string;
  scope: 'subject' | 'learning_skills';
  report: ComposerReport;
  grades: { code: string; label: string }[];
  bank: { itemId: string; revision: number } | null;
  entriesFor: (gradeCode: string | null) => ResolvedEntry[];
  taught: ReadonlySet<string> | null;
  parents: ReadonlyMap<string, string | null>;
  limit: number;
  plainSpacesOnCopy: boolean;
  update: (change: (student: ReportDraftStudent) => ReportDraftStudent) => void;
  onPrint: () => void;
  /** « Tout copier pour cet élève »: every subject's comment, with its subject. */
  copyAllText: () => string;
  previous: EditorStudent | null;
  next: EditorStudent | null;
  onBackToList: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const t = useTranslations('reportComments');
  const id = useId();
  const editKey = `${student.id}:${subjectKey}`;
  const comment = draft.comments[subjectKey] ?? emptyDraftComment();
  const gradeCode = draft.gradeCode ?? grades[0]?.code ?? null;
  const entries = useMemo(() => entriesFor(gradeCode), [entriesFor, gradeCode]);
  const currentPicks = useMemo(
    () =>
      bank
        ? comment.picks.filter((p) => p.itemId === bank.itemId && p.revision === bank.revision)
        : [],
    [bank, comment.picks],
  );
  const picked = useMemo(() => new Set(currentPicks.map((p) => p.index)), [currentPicks]);
  const suggestions = useMemo(
    () =>
      suggestEntries({
        entries,
        scope,
        report,
        mark: comment,
        taught,
        parents,
        notes: draft.notes,
      }),
    [comment, draft.notes, entries, parents, report, scope, taught],
  );
  const [askReplace, setAskReplace] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setComment = (change: (c: ReportDraftComment) => ReportDraftComment) =>
    update((s) => ({
      ...s,
      comments: {
        ...s.comments,
        [subjectKey]: change(s.comments[subjectKey] ?? emptyDraftComment()),
      },
    }));

  // Entries ticked and the text not edited by hand: the text follows the ticked entries in the
  // student's wording (after « Formulation » changes, or in another subject than the one where
  // the wording changed).
  const composed =
    bank && currentPicks.length > 0 ? composeFromPicks(entries, currentPicks, draft.form) : null;
  useEffect(() => {
    if (composed === null || comment.edited || composed === comment.text) return;
    update((s) => {
      const c = s.comments[subjectKey];
      if (!c || c.edited) return s;
      return { ...s, comments: { ...s.comments, [subjectKey]: { ...c, text: composed } } };
    });
  }, [comment.edited, comment.text, composed, subjectKey, update]);

  const toggle = (index: number) => {
    if (!bank) return;
    const picks = picked.has(index)
      ? currentPicks.filter((p) => p.index !== index)
      : [...currentPicks, { itemId: bank.itemId, revision: bank.revision, index }];
    const text = composeFromPicks(entries, picks, draft.form);
    if (comment.edited && comment.text.trim()) {
      setComment((c) => ({ ...c, picks }));
      setAskReplace(editKey);
      return;
    }
    setComment((c) => ({ ...c, picks, text, edited: false }));
  };
  const replace = () => {
    setComment((c) => ({
      ...c,
      text: composeFromPicks(entries, currentPicks, draft.form),
      edited: false,
    }));
    setAskReplace(null);
  };

  const [allCopied, setAllCopied] = useState(false);
  useEffect(() => {
    if (!allCopied) return;
    const timer = window.setTimeout(() => setAllCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [allCopied]);

  const needsMarkText =
    scope === 'learning_skills'
      ? t('editor.needsRatings')
      : report === 'progress'
        ? t('editor.needsProgress')
        : t('editor.needsMark');

  return (
    <article aria-labelledby={`${id}-name`} className="min-w-0 scroll-mt-24 space-y-5">
      <div className="space-y-2">
        <a
          href="#eleves"
          onClick={onBackToList}
          className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900 md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t('students.back')}
        </a>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            ref={headingRef}
            id={`${id}-name`}
            tabIndex={-1}
            className="scroll-mt-24 text-xl font-bold text-slate-900 outline-none"
          >
            {student.firstName}
            <span className="sr-only"> · {subjectLabel}</span>
          </h3>
          <nav aria-label={t('students.around')} className="flex gap-1">
            {previous ? (
              <a
                href={`#eleve-${previous.id}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <ChevronLeft className="size-4" aria-hidden />
                <span className="sr-only">{t('students.previous')} : </span>
                {previous.firstName}
              </a>
            ) : null}
            {next ? (
              <a
                href={`#eleve-${next.id}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <span className="sr-only">{t('students.next')} : </span>
                {next.firstName}
                <ChevronRight className="size-4" aria-hidden />
              </a>
            ) : null}
          </nav>
        </div>
        <p className="text-sm text-slate-600">{subjectLabel}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Segmented<CommentForm>
          legend={t('editor.form')}
          hint={t('editor.formHint')}
          options={COMMENT_FORMS.map((f) => ({ value: f, label: t(`editor.forms.${f}`) }))}
          value={draft.form}
          onChange={(form) => update((s) => ({ ...s, form }))}
          columns="grid-cols-3"
        />
        {grades.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-grade`}>{t('editor.grade')}</Label>
            <Select
              id={`${id}-grade`}
              value={gradeCode ?? ''}
              onChange={(e) => update((s) => ({ ...s, gradeCode: e.target.value }))}
              aria-describedby={`${id}-grade-hint`}
            >
              {grades.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </Select>
            <p id={`${id}-grade-hint`} className="text-sm text-slate-600">
              {t('editor.gradeHint')}
            </p>
          </div>
        ) : null}
      </div>

      <MarkFields
        scope={scope}
        report={report}
        comment={comment}
        onLevel={(level) => setComment((c) => ({ ...c, level }))}
        onProgress={(progress) => setComment((c) => ({ ...c, progress }))}
        onRating={(skill, rating) =>
          setComment((c) => ({ ...c, ratings: { ...c.ratings, [skill]: rating } }))
        }
      />

      {bank ? (
        <EntryPicker
          suggestions={suggestions}
          firstName={student.firstName}
          form={draft.form}
          picked={picked}
          onToggle={toggle}
          needsMarkText={needsMarkText}
        />
      ) : null}

      {askReplace === editKey ? (
        <div
          role="group"
          aria-labelledby={`${id}-replace`}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
        >
          <p id={`${id}-replace`} className="w-full text-sm text-amber-900">
            {t('editor.replaceQuestion')}
          </p>
          <Button size="md" onClick={replace}>
            {t('editor.replace')}
          </Button>
          <Button size="md" variant="secondary" onClick={() => setAskReplace(null)}>
            {t('editor.keep')}
          </Button>
        </div>
      ) : null}

      <CommentField
        editKey={editKey}
        label={t('editor.comment')}
        hint={t('editor.commentHint')}
        firstName={student.firstName}
        template={comment.text}
        limit={limit}
        plainSpacesOnCopy={plainSpacesOnCopy}
        textareaRef={textareaRef}
        onTemplateChange={(text) => setComment((c) => ({ ...c, text, edited: true }))}
      >
        <Button
          variant="secondary"
          onClick={async () => setAllCopied(await copyText(copyAllText()))}
        >
          <ClipboardCopy aria-hidden />
          {allCopied ? t('editor.copiedAll') : t('editor.copyAll')}
        </Button>
        <Button variant="secondary" onClick={onPrint} disabled={!comment.text.trim()}>
          <Printer aria-hidden />
          {t('editor.print')}
        </Button>
        <ConfirmButton
          label={t('editor.clearComment')}
          message={t('editor.clearCommentMessage', {
            name: student.firstName,
            subject: subjectLabel,
          })}
          confirmLabel={t('editor.clearConfirm')}
          size="md"
          variant="ghost"
          onConfirm={() => {
            setComment(() => emptyDraftComment());
            setAskReplace(null);
          }}
        >
          <Trash2 aria-hidden />
          <span>{t('editor.clearComment')}</span>
        </ConfirmButton>
      </CommentField>
      <p className="sr-only" aria-live="polite">
        {allCopied ? t('editor.copiedAll') : ''}
      </p>

      {next ? (
        <div className="flex justify-end">
          <Button asChild variant="secondary">
            <a href={`#eleve-${next.id}`}>
              {t('students.nextNamed', { name: next.firstName })}
              <ChevronRight aria-hidden />
            </a>
          </Button>
        </div>
      ) : null}

      <NotesField
        key={student.id}
        firstName={student.firstName}
        notes={draft.notes}
        onChange={(notes) => update((s) => ({ ...s, notes }))}
      />
    </article>
  );
}

/**
 * « Mes notes (sur cet appareil) »: a few words about the student, for the teacher only, kept in
 * template form on the device; the bank's entries that share a word with them come first
 * (« D'après vos notes »). No AI.
 */
function NotesField({
  firstName,
  notes,
  onChange,
}: {
  firstName: string;
  notes: string;
  onChange: (notes: string) => void;
}) {
  const t = useTranslations('reportComments.editor');
  const id = useId();
  const [local, setLocal] = useState(() => ({ notes, display: fillComment(notes, firstName) }));
  if (local.notes !== notes) setLocal({ notes, display: fillComment(notes, firstName) });
  return (
    <details className="rounded-lg border border-slate-200 bg-white" open={notes.trim() !== ''}>
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-slate-800">
        {t('notes')}
      </summary>
      <div className="space-y-1.5 p-3 pt-0">
        <Label htmlFor={`${id}-notes`} className="sr-only">
          {t('notes')}
        </Label>
        <Textarea
          id={`${id}-notes`}
          lang="fr-CA"
          rows={3}
          value={local.notes === notes ? local.display : fillComment(notes, firstName)}
          aria-describedby={`${id}-notes-hint`}
          onChange={(e) => {
            const next = unfillComment(e.target.value, firstName);
            setLocal({ notes: next, display: e.target.value });
            onChange(next);
          }}
        />
        <p id={`${id}-notes-hint`} className="text-sm text-slate-600">
          {t('notesHint')}
        </p>
      </div>
    </details>
  );
}
