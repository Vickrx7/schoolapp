'use client';

import {
  composeSubPlan,
  type ComposedBlock,
  type SubPlanEdits,
  type SubPlanV1,
} from '@lynx/domain';
import { CloudOff, Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { useErrorText } from '@/hooks/use-action';
import { useDraft } from '@/hooks/use-draft';
import { useOnline } from '@/hooks/use-online';
import { formatInstantTime } from '@/lib/format';
import { saveSubPlanEdits } from '@/server/actions/sub-plans';
import { AlertsReveal } from './alerts-reveal';
import { TypedText } from './block-card';
import { DetachedEditsNotice } from './detached-edits-notice';
import {
  reattachEdit,
  resetBlock,
  resetChecklist,
  setBlockNote,
  setBlockSteps,
  setChecklist,
  setFaith,
  setOverview,
  stepsForEditing,
  toPayload,
} from './edits';
import { registerPlanFlush } from './plan-flush';
import { PlanSection, PlanView } from './plan-view';
import { ChecklistEditor, StepListEditor } from './step-list-editor';
import type { PlanContext, PlanLevel, RosterStudent } from './types';

/** How long after the last change the plan is saved. */
const SAVE_DELAY_MS = 3000;
/** How long before trying again after the connection dropped. */
const OFFLINE_RETRY_MS = 15_000;

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict';

interface PlanEditorProps {
  userId: string;
  planId: string;
  plan: SubPlanV1;
  initialEdits: SubPlanEdits | null;
  editsRevision: number;
  /** The AI layer (D-052): shown under the teacher's edits. */
  ai?: unknown;
  context: PlanContext;
  roster: RosterStudent[];
  levels: PlanLevel[];
  alertsEnabled: boolean;
  editable: boolean;
}

/**
 * « Réviser le plan »: the owner's plan with inline editing. Changes are an overlay on the
 * generated plan (D-048), kept on this device as a draft while she types and saved to the
 * server 3 seconds after the last change. Saving checks the revision she started from, so two
 * devices never overwrite each other silently.
 *
 * Other refreshes of the page (the AI request finishing, her own saves) flow in as props and
 * leave the editor as it is: open editors, focus and the draft stay. Only « Prendre la plus
 * récente » starts the editor over, once the newer version has loaded.
 */
export function PlanEditor(props: PlanEditorProps) {
  const router = useRouter();
  const [generation, setGeneration] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [loading, startLoading] = useTransition();
  useEffect(() => {
    if (!waiting || loading) return;
    // The newer version is on the page: start over from it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs once per « Prendre la plus récente »
    setWaiting(false);
    setGeneration((g) => g + 1);
  }, [waiting, loading]);
  const takeLatest = useCallback(() => {
    setWaiting(true);
    startLoading(() => router.refresh());
  }, [router]);
  return (
    <PlanEditorBody key={generation} {...props} reloading={waiting} onTakeLatest={takeLatest} />
  );
}

function PlanEditorBody({
  userId,
  planId,
  plan,
  initialEdits,
  editsRevision,
  ai = null,
  context,
  roster,
  levels,
  alertsEnabled,
  editable,
  reloading,
  onTakeLatest,
}: PlanEditorProps & {
  /** « Prendre la plus récente » is loading the newer version: nothing is saved meanwhile. */
  reloading: boolean;
  onTakeLatest: () => void;
}) {
  const t = useTranslations('subPlan');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const locale = useLocale();
  const online = useOnline();

  const initial = useMemo(() => ({ edits: initialEdits ?? {} }), [initialEdits]);
  const [revision, setRevision] = useState(editsRevision);
  const draft = useDraft(`sub-plan:${userId}:${planId}`, initial, {
    version: String(revision),
  });
  const { setValue, clear: clearDraft } = draft;
  const edits = draft.value.edits;
  const change = useCallback(
    (fn: (e: SubPlanEdits) => SubPlanEdits) => setValue((v) => ({ edits: fn(v.edits) })),
    [setValue],
  );
  const composed = useMemo(
    () => composeSubPlan(plan, { edits, ai, audience: 'owner' }),
    [plan, edits, ai],
  );

  // ---- Saving -------------------------------------------------------------------------
  const payload = useMemo(() => toPayload(edits), [edits]);
  const payloadJson = JSON.stringify(payload);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(toPayload(initialEdits ?? {})));
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; json: string } | null>(null);
  const latest = useRef({ payload, json: payloadJson, revision });
  /** What the server has, and whether saving is refused until she chooses (conflict). */
  const saved = useRef({ json: savedJson, conflict: false });
  const inFlight = useRef<Promise<void> | null>(null);
  useEffect(() => {
    latest.current = { payload, json: payloadJson, revision };
  }, [payload, payloadJson, revision]);

  const save = useCallback(
    (overwrite = false): Promise<void> => {
      if (!editable) return Promise.resolve();
      if (inFlight.current) return inFlight.current;
      const run = async () => {
        const sent = latest.current;
        setState('saving');
        try {
          const result = await saveSubPlanEdits(planId, sent.payload, sent.revision, {
            overwrite,
          });
          if (result.ok) {
            latest.current = { ...latest.current, revision: result.data.revision };
            saved.current = { json: sent.json, conflict: false };
            setRevision(result.data.revision);
            setSavedJson(sent.json);
            setSavedAt(result.data.savedAt);
            setError(null);
            setState('saved');
            // Nothing typed during the save: the device copy is no longer needed.
            if (latest.current.json === sent.json) clearDraft();
          } else if (result.error === 'subPlanConflict') {
            saved.current = { ...saved.current, conflict: true };
            setState('conflict');
          } else {
            setError({ key: result.error, json: sent.json });
            setState('error');
          }
        } catch {
          setState('offline');
        }
      };
      inFlight.current = run().finally(() => {
        inFlight.current = null;
      });
      return inFlight.current;
    },
    [planId, editable, clearDraft],
  );

  // Another part of the page (the AI preview) can have the pending changes saved first.
  useEffect(
    () =>
      registerPlanFlush(planId, async () => {
        if (inFlight.current) await inFlight.current;
        if (!editable || reloading || saved.current.conflict) return;
        if (latest.current.json !== saved.current.json) await save();
      }),
    [planId, editable, reloading, save],
  );

  const dirty = payloadJson !== savedJson;
  useEffect(() => {
    if (!editable || !dirty || !online || reloading) return;
    if (state === 'saving' || state === 'conflict') return;
    // A refused save is not retried until something changes (or « Réessayer »).
    if (state === 'error' && error?.json === payloadJson) return;
    const timer = window.setTimeout(
      () => void save(),
      state === 'offline' ? OFFLINE_RETRY_MS : SAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [editable, dirty, online, reloading, state, error, payloadJson, save]);

  const takeLatest = () => {
    // PlanEditor starts this editor over once the newer revision has loaded.
    clearDraft();
    setState('idle');
    onTakeLatest();
  };

  // ---- Editing controls ---------------------------------------------------------------
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string, on: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [faithOpen, setFaithOpen] = useState(false);

  const rawNote = (b: ComposedBlock) => {
    const edit = edits.blocks?.[b.key];
    return edit && edit.forLessonId === (b.lesson?.lessonId ?? null)
      ? (edit.teacherNote ?? '')
      : '';
  };

  const blockSlot = (b: ComposedBlock) => {
    if (!editable) return undefined;
    if (!open.has(b.key)) {
      return {
        actions: (
          <Button variant="secondary" onClick={() => toggle(b.key, true)}>
            <Pencil aria-hidden />
            {t('editSteps')}
          </Button>
        ),
      };
    }
    return {
      steps: (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <StepListEditor
            idPrefix={`steps-${b.key}`}
            steps={stepsForEditing(b)}
            onChange={(steps) => change((e) => setBlockSteps(e, b, steps))}
          />
          <Field label={t('teacherNote')} htmlFor={`note-${b.key}`}>
            <Textarea
              id={`note-${b.key}`}
              value={rawNote(b)}
              maxLength={1000}
              className="min-h-16"
              onChange={(e) => change((ed) => setBlockNote(ed, b, e.target.value))}
            />
          </Field>
        </div>
      ),
      actions: (
        <>
          <Button onClick={() => toggle(b.key, false)}>{t('doneEditing')}</Button>
          {b.edited ? (
            <Button variant="ghost" onClick={() => change((e) => resetBlock(e, b.key))}>
              {t('resetBlock')}
            </Button>
          ) : null}
        </>
      ),
    };
  };

  const checklist = edits.endOfDayChecklist ?? plan.endOfDay.checklist;
  const endOfDaySlot = editable ? (
    checklistOpen ? (
      <div className="space-y-2">
        <ChecklistEditor
          idPrefix="checklist"
          items={checklist}
          onChange={(items) => change((e) => setChecklist(e, items))}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setChecklistOpen(false)}>{t('doneEditing')}</Button>
          {edits.endOfDayChecklist ? (
            <Button variant="ghost" onClick={() => change(resetChecklist)}>
              {t('resetBlock')}
            </Button>
          ) : null}
        </div>
      </div>
    ) : (
      <div className="space-y-2">
        {composed.endOfDay.checklist.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
            {composed.endOfDay.checklist.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : null}
        <Button variant="secondary" onClick={() => setChecklistOpen(true)}>
          <Pencil aria-hidden />
          {t('editChecklist')}
        </Button>
      </div>
    )
  ) : undefined;

  let faithSlot: ReactNode | undefined;
  if (editable && composed.faith) {
    faithSlot = (
      <PlanSection title={t('sections.faith')}>
        {composed.faith.title ? (
          <p className="text-sm font-medium text-slate-800">{composed.faith.title}</p>
        ) : null}
        {faithOpen ? (
          <Field label={t('faithText')} htmlFor="faith-text">
            <Textarea
              id="faith-text"
              value={edits.faith?.text ?? composed.faith.text}
              maxLength={1000}
              onChange={(e) => change((ed) => setFaith(ed, { text: e.target.value }))}
            />
          </Field>
        ) : (
          <TypedText text={composed.faith.text} className="text-sm text-slate-800" />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setFaithOpen((o) => !o)}>
            {faithOpen ? t('doneEditing') : t('faithEdit')}
          </Button>
          {edits.faith ? (
            <Button variant="ghost" onClick={() => change((e) => setFaith(e, undefined))}>
              {t('resetBlock')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => {
              setFaithOpen(false);
              change((e) => setFaith(e, null));
            }}
          >
            {t('faithRemove')}
          </Button>
        </div>
      </PlanSection>
    );
  } else if (editable && edits.faith === null && plan.faith) {
    faithSlot = (
      <PlanSection title={t('sections.faith')}>
        <p className="text-sm text-slate-600">{t('faithRemoved')}</p>
        <div>
          <Button variant="secondary" onClick={() => change((e) => setFaith(e, undefined))}>
            {t('faithRestore')}
          </Button>
        </div>
      </PlanSection>
    );
  }

  const top = (
    <>
      {draft.restored ? (
        <Notice className="flex flex-wrap items-center justify-between gap-2">
          <span>{tCommon('draftRestored')}</span>
          <Button variant="ghost" size="sm" onClick={draft.discard}>
            {tCommon('discardDraft')}
          </Button>
        </Notice>
      ) : null}
      {draft.offered ? (
        <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('draftOffered')}</span>
          <Button variant="secondary" size="sm" onClick={draft.recover}>
            {t('draftRecover')}
          </Button>
        </Notice>
      ) : null}
      <DetachedEditsNotice
        detached={composed.detachedEdits}
        disabled={!editable}
        onApply={(d) => change((e) => reattachEdit(e, d))}
        onDiscard={(d) => change((e) => resetBlock(e, d.blockKey))}
      />
    </>
  );

  let status: ReactNode;
  if (!editable) status = t('readOnly');
  else if (!online || state === 'offline') {
    status = (
      <span className="inline-flex items-center gap-1.5 text-amber-800">
        <CloudOff className="size-4" aria-hidden />
        {t('offlineSaved')}
      </span>
    );
  } else if (state === 'error') {
    status = (
      <span className="inline-flex flex-wrap items-center gap-2 text-red-700">
        {t('saveFailed')} {errorText(error?.key)}
        <Button variant="secondary" onClick={() => void save()}>
          {t('retry')}
        </Button>
      </span>
    );
  } else if (state === 'saving') status = t('saving');
  else if (dirty) status = t('unsaved');
  else if (savedAt) {
    status = t('saved', { time: formatInstantTime(savedAt, context.timezone, locale) });
  } else status = t('editHint');

  return (
    <>
      <PlanView
        plan={composed}
        context={context}
        roster={roster}
        levels={levels}
        slots={{
          top,
          overview: editable ? (
            <Field label={t('overview')} htmlFor="plan-overview" hint={t('overviewHint')}>
              <Textarea
                id="plan-overview"
                value={edits.overview ?? ''}
                maxLength={2000}
                className="min-h-16"
                onChange={(e) => change((ed) => setOverview(ed, e.target.value))}
              />
            </Field>
          ) : undefined,
          block: blockSlot,
          endOfDay: endOfDaySlot,
          faith: faithSlot,
          alerts: alertsEnabled
            ? (cls) => (
                <AlertsReveal
                  classId={cls.classId}
                  className={cls.name}
                  showClassName={composed.classes.length > 1}
                  roster={roster}
                />
              )
            : undefined,
        }}
      />

      <div
        className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-700 backdrop-blur md:bottom-4 md:mx-0 md:rounded-xl md:border print:hidden"
        role="status"
        aria-live="polite"
        data-testid="plan-save-status"
      >
        {status}
      </div>

      <Dialog
        open={state === 'conflict'}
        onOpenChange={(isOpen) => {
          // Closed without choosing: nothing is lost, the changes stay unsaved on this device.
          if (!isOpen) {
            setError({ key: 'subPlanConflict', json: latest.current.json });
            setState('error');
          }
        }}
      >
        <DialogContent
          title={t('conflict.title')}
          description={t('conflict.body')}
          closeLabel={tCommon('close')}
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={takeLatest}>
              {t('conflict.takeLatest')}
            </Button>
            <Button onClick={() => void save(true)}>{t('conflict.keepMine')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
