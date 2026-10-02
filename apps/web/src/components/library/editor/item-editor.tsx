'use client';

import { TYPE_INFO, subFriendlyAllowed } from '@lynx/content';
import type { LibraryItemStatus } from '@lynx/db';
import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { storeDraft } from '@/hooks/draft-storage';
import { useAction } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { formatInstantTime } from '@/lib/format';
import { saveLibraryItem } from '@/server/actions/library';
import type { EditorContext } from '@/server/library/editor-context';
import type { LibraryEditorForm } from '@/server/library/editor-form';
import { NamesDialog, type NamesCheckState } from '../names-dialog';
import { EditorErrorsProvider } from './editor-errors';
import { CurriculumFields } from './expectation-picker';
import { FaithFields } from './faith-fields';
import { MetaFields } from './meta-fields';
import { SafetyNotesFields } from './safety-notes-fields';
import { VersionContent } from './version-content';
import { VersionsEditor } from './versions-editor';

export interface ItemEditorProps {
  mode: 'new' | 'edit';
  /** The item being edited; null for a new one (the browser picks its id). */
  itemId: string | null;
  /** The revision `initial` was read at (null for a new item). */
  contentRevision: number | null;
  initial: LibraryEditorForm;
  context: EditorContext;
  status: LibraryItemStatus;
  /** Shared with the school or the board: a save goes through the first-name guard. */
  shared: boolean;
  /** Shared with the whole board: a save that needs a faith review takes it back to the school. */
  boardWide: boolean;
  /** « En attente d’approbation »: a save withdraws the request (D-063). */
  requested: boolean;
  /** Its faith content was reviewed: a save needs a new faith review (D-063, D-064). */
  faithReviewed: boolean;
  /** A reviewer flagged faith content: the author cannot clear it. */
  faithFlagged: boolean;
}

/** Whether the form holds faith content (the database's rule, `requires_faith_review`, D-064). */
function formNeedsFaithReview(form: LibraryEditorForm, subjectCode: string | null): boolean {
  return (
    form.type === 'catholic_reflection' ||
    form.faithContent ||
    form.catholicConnection.trim() !== '' ||
    form.catholicReferenceId !== null ||
    subjectCode === 'ere'
  );
}

/**
 * « Nouvelle ressource » and « Modifier la ressource » (DECISIONS D-061 to D-067): sections
 * « À propos », « Curriculum », « Contenu », « Versions par niveau », « Sécurité » and « Foi »,
 * and a save bar that stays in view. The form is a device draft (D-035, user-scoped D-044): a
 * crash or a lost connection never loses work. When someone else saved the item meanwhile
 * (`LXL07`), the page reloads the newer version and the hook offers « Récupérer mes changements ».
 * A save of a resource waiting for approval withdraws the request, ends an earlier faith review
 * (D-063) and takes faith content off the whole board until its faith review (D-064): the page
 * says so, and asks before a save that does any of this; a form without changes is never sent.
 */
export function ItemEditor(props: ItemEditorProps) {
  const router = useRouter();
  // Remounted with the server's newer version after a conflict, so the draft is offered.
  const [generation, setGeneration] = useState(0);
  const conflictAt = useRef<number | null>(null);
  useEffect(() => {
    if (conflictAt.current !== null && props.contentRevision !== conflictAt.current) {
      conflictAt.current = null;
      setGeneration((g) => g + 1);
    }
  }, [props.contentRevision]);
  return (
    <EditorBody
      key={generation}
      {...props}
      onConflict={(revision) => {
        conflictAt.current = revision;
        router.refresh();
      }}
    />
  );
}

interface DraftValue {
  itemId: string;
  form: LibraryEditorForm;
}

function EditorBody({
  mode,
  itemId,
  contentRevision,
  initial,
  context,
  status,
  shared,
  boardWide,
  requested,
  faithReviewed,
  faithFlagged,
  onConflict,
}: ItemEditorProps & { onConflict: (revision: number) => void }) {
  const t = useTranslations('libraryEdit');
  const tc = useTranslations('libraryCommon');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const start = useMemo<DraftValue>(
    () => ({ itemId: itemId ?? crypto.randomUUID(), form: initial }),
    // Once per mount: a new item keeps the id it was given (and its draft keeps it too).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const draftKey =
    mode === 'new'
      ? `library-item:${context.userId}:new:${initial.type}`
      : `library-item:${context.userId}:${itemId}`;
  const [revision, setRevision] = useState<number | null>(contentRevision);
  const draft = useDraft<DraftValue>(draftKey, start, {
    version: revision === null ? undefined : String(revision),
  });
  const { form } = draft.value;
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState(() => JSON.stringify(start.form));
  const [names, setNames] = useState<NamesCheckState | null>(null);
  // The state a save changes besides the content (D-063, D-064), as of the last save: a save
  // withdraws the request, ends the faith review and, when the form needs a faith review, takes
  // the resource off the whole board (the database's rules, followed here without a reload).
  const [effects, setEffects] = useState({ requested, faithReviewed, boardWide });
  // « Enregistrer quand même » was chosen for the next save: it does not ask twice.
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const latest = useRef(draft.value);
  useEffect(() => {
    latest.current = draft.value;
  }, [draft.value]);

  const save = useAction(saveLibraryItem);
  const fieldErrors = save.fieldErrors;
  const dirty = JSON.stringify(form) !== lastSaved;

  const patch = (changes: Partial<LibraryEditorForm>) =>
    draft.setValue((prev) => ({ ...prev, form: { ...prev.form, ...changes } }));

  const subjectCodeOf = (f: LibraryEditorForm) =>
    context.subjects.find((s) => s.id === f.subjectId)?.code ?? null;
  const subjectCode = subjectCodeOf(form);
  const info = TYPE_INFO[form.type];
  // The attentes « Curriculum » last loaded: a comment bank ties its entries to the chosen ones.
  const [expectationOptions, setExpectationOptions] = useState(context.expectations);
  const chosenExpectations = useMemo(() => {
    const seen = new Set<string>();
    return expectationOptions
      .filter((e) => form.expectationIds.includes(e.id))
      .filter((e) => !seen.has(e.code) && Boolean(seen.add(e.code)))
      .map((e) => ({ code: e.code, text: e.text }));
  }, [expectationOptions, form.expectationIds]);
  const baseIndex = Math.max(
    0,
    form.versions.findIndex((v) => v.languageLevelId === null),
  );

  // What the next save changes besides the content (D-063, D-064).
  const saveEffects = [
    ...(effects.requested ? [t('requestedNotice')] : []),
    ...(effects.faithReviewed ? [t('faithReviewedNotice')] : []),
    ...(effects.boardWide && formNeedsFaithReview(form, subjectCode)
      ? [t('boardFaithNotice')]
      : []),
  ];

  const run = async (confirmedNames: string[] = []) => {
    const sent = draft.value;
    // Nothing changed since the last save: nothing to send (and no request to withdraw).
    if (mode === 'edit' && JSON.stringify(sent.form) === lastSaved) return;
    const result = await save.run(sent.itemId, revision, sent.form, confirmedNames);
    if (!result) return; // network: the draft is kept and the error shown
    if (!result.ok) {
      if (result.error === 'libraryConflict' && revision !== null) onConflict(revision);
      if (result.fieldErrors) {
        toast.error(result.error === 'libraryNotReady' ? t('save.notReady') : t('save.fix'));
      }
      return;
    }
    if (result.data.status === 'names') {
      setNames({ names: result.data.names, blocked: result.data.blocked });
      return;
    }
    setNames(null);
    const { itemId: savedId, contentRevision: newRevision } = result.data;
    if (mode === 'new') {
      // What was typed while the first save ran becomes the draft of the edit page.
      if (JSON.stringify(latest.current) !== JSON.stringify(sent)) {
        storeDraft(`library-item:${context.userId}:${savedId}`, latest.current, {
          version: String(newRevision),
        });
      }
      draft.clear();
      toast.success(t('save.created'));
      router.replace(`/library/items/${savedId}/edit`);
      return;
    }
    setRevision(newRevision);
    setSavedAt(result.data.savedAt);
    setLastSaved(JSON.stringify(sent.form));
    setEffects({
      requested: false,
      faithReviewed: false,
      boardWide: effects.boardWide && !formNeedsFaithReview(sent.form, subjectCodeOf(sent.form)),
    });
    setAcknowledged(false);
    // What was typed while saving stays a draft.
    if (JSON.stringify(latest.current) === JSON.stringify(sent)) draft.clear();
  };

  const status_ = save.pending
    ? tCommon('saving')
    : save.error && Object.keys(save.fieldErrors).length === 0
      ? t('save.failed')
      : dirty
        ? t('save.unsaved')
        : savedAt
          ? t('save.savedAt', { time: formatInstantTime(savedAt, 'America/Toronto', locale) })
          : mode === 'new'
            ? t('save.notYet')
            : t('save.upToDate');

  const within = (...prefixes: string[]) =>
    Object.keys(fieldErrors).some((k) => prefixes.some((p) => k === p || k.startsWith(`${p}.`)));
  const baseFlag = within(`versions.${baseIndex}`);
  const levelsFlag = form.versions.some(
    (v, i) => v.languageLevelId !== null && within(`versions.${i}`),
  );

  return (
    <EditorErrorsProvider errors={fieldErrors}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'edit' && !dirty) return;
          if (saveEffects.length > 0 && !acknowledged) {
            setConfirming(true);
            return;
          }
          void run();
        }}
      >
        {draft.restored ? (
          <Notice className="flex flex-wrap items-center justify-between gap-2">
            <span>{tCommon('draftRestored')}</span>
            <Button variant="ghost" onClick={() => draft.discard()}>
              {tCommon('discardDraft')}
            </Button>
          </Notice>
        ) : null}
        {draft.offered ? (
          <Notice tone="warning" className="space-y-2">
            <p>{t('draftOlder')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => draft.recover()}>
                {t('recoverDraft')}
              </Button>
              <Button variant="ghost" onClick={() => draft.discard()}>
                {tCommon('discardDraft')}
              </Button>
            </div>
          </Notice>
        ) : null}
        {status === 'teacher_reviewed' ? <Notice>{t('reviewedNotice')}</Notice> : null}
        {shared ? <Notice>{t('sharedNotice')}</Notice> : null}
        {saveEffects.map((text) => (
          <Notice key={text} tone="warning">
            {text}
          </Notice>
        ))}

        <Section
          title={t('sections.about')}
          flagged={within(
            'title',
            'summary',
            'durationMinutes',
            'materials',
            'licence',
            'keywords',
            'tagIds',
            'subFriendly',
            'readiness.duration',
            'readiness.materials',
            'readiness.tags',
          )}
        >
          <MetaFields form={form} patch={patch} context={context} isNew={mode === 'new'} />
        </Section>

        <Section
          title={t('sections.curriculum')}
          flagged={within(
            'gradeCodes',
            'subjectId',
            'expectationIds',
            'readiness.grades',
            'readiness.subject',
            'readiness.expectations',
          )}
        >
          <CurriculumFields
            form={form}
            patch={patch}
            context={context}
            onOptions={setExpectationOptions}
          />
        </Section>

        <Section
          title={t('sections.content')}
          flagged={baseFlag || within('readiness.content', 'readiness.key', 'readiness.base')}
        >
          <p className="mb-4 text-sm text-slate-600">
            {t('contentIntro', { type: tc(`types.${form.type}`) })}
          </p>
          <VersionContent
            form={form}
            index={baseIndex}
            subjectCode={subjectCode}
            expectations={chosenExpectations}
            onChange={(version) =>
              patch({ versions: form.versions.map((v, i) => (i === baseIndex ? version : v)) })
            }
          />
        </Section>

        {info.levelable ? (
          <Section title={t('sections.levels')} flagged={levelsFlag || within('versions')}>
            <VersionsEditor form={form} patch={patch} context={context} subjectCode={subjectCode} />
          </Section>
        ) : null}

        {info.needsSafety ? (
          <Section title={t('sections.safety')} flagged={within('safetyNotes', 'readiness.safety')}>
            <SafetyNotesFields
              notes={form.safetyNotes}
              onChange={(safetyNotes) =>
                // Closer supervision than « habituelle » rules out a substitute (D-077).
                patch(
                  subFriendlyAllowed(form.type, safetyNotes)
                    ? { safetyNotes }
                    : { safetyNotes, subFriendly: false },
                )
              }
            />
          </Section>
        ) : null}

        <Section
          title={t('sections.faith')}
          flagged={within('catholicConnection', 'catholicReferenceId')}
        >
          <FaithFields
            form={form}
            patch={patch}
            context={context}
            flaggedByReviewer={faithFlagged}
          />
        </Section>

        <div
          className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-4 md:mx-0 md:rounded-xl md:border"
          data-testid="library-save-bar"
        >
          <p className="text-sm text-slate-700" role="status" aria-live="polite">
            {status_}
          </p>
          <div className="flex flex-wrap gap-2">
            {mode === 'edit' && itemId ? (
              <Button asChild variant="secondary">
                <Link href={`/library/items/${itemId}`}>{t('save.view')}</Link>
              </Button>
            ) : null}
            <Button type="submit" disabled={save.pending || (mode === 'edit' && !dirty)}>
              {save.pending ? tCommon('saving') : t('save.save')}
            </Button>
          </div>
        </div>
      </form>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent title={t('confirmSave.title')} closeLabel={tCommon('close')}>
          <div className="space-y-2 text-slate-700">
            {saveEffects.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                setAcknowledged(true);
                void run();
              }}
            >
              {t('confirmSave.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <NamesDialog
        state={names}
        pending={save.pending}
        onClose={() => setNames(null)}
        onConfirm={(confirmed) => void run(confirmed)}
        confirmLabel={t('save.save')}
      />
    </EditorErrorsProvider>
  );
}

/** One section of the editor: a disclosure, open by default and again when it holds an error. */
function Section({
  title,
  flagged,
  children,
}: {
  title: string;
  flagged: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('libraryEdit');
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an error must be in view
    if (flagged) setOpen(true);
  }, [flagged]);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <span className="flex items-center gap-2">
          {flagged ? <Badge tone="danger">{t('toFix')}</Badge> : null}
          <ChevronDown
            className="size-5 text-slate-500 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-4">{children}</div>
    </details>
  );
}
