'use client';

import type { LibraryItemType } from '@lynx/content';
import { CalendarPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { useAction, useErrorText } from '@/hooks/use-action';
import {
  addItemAsLesson,
  attachItemToLesson,
  listPlanningTargets,
  type PlanningTargetsResult,
} from '@/server/actions/library-planning';
import {
  defaultClass,
  defaultLesson,
  defaultMode,
  defaultUnit,
  nextLesson,
  orderUnits,
  positionChoices,
  positionKey,
  positionNumber,
  unitPlanningHref,
  type NewLessonPosition,
  type PlanningLesson,
  type PlanningMode,
} from '@/server/library/planning-targets';

/**
 * « Ajouter à ma planification » (DECISIONS D-076): class, then unit (the resource's subject
 * first), then « Joindre à une leçon » (materials, by default: the next lesson not yet done that
 * shares an attente) or « Nouvelle leçon » (lesson plans and projects, by default: at the end of
 * the unit). Everything is chosen already when the dialog opens, so on a phone it takes two taps.
 * A bottom sheet on phones, a dialog on larger screens.
 */
export function PlanningDialog({
  itemId,
  itemType,
}: {
  itemId: string;
  itemType: LibraryItemType;
}) {
  const t = useTranslations('libraryPlanning');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [targets, setTargets] = useState<PlanningTargetsResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classId, setClassId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [mode, setMode] = useState<PlanningMode>(defaultMode(itemType));
  const [position, setPosition] = useState('end');
  const [replacing, setReplacing] = useState<string | null>(null);

  const showUnit = (cls: string, unit: string) => ({
    label: t('seePlanning'),
    onClick: () => router.push(unitPlanningHref(cls, unit)),
  });
  const attach = useAction(attachItemToLesson);
  const add = useAction(addItemAsLesson, {
    onSuccess: (data) => {
      setOpen(false);
      toast.success(t('added', { n: data.sequenceNumber }), {
        action: showUnit(data.classId, data.unitId),
      });
      router.refresh();
    },
  });

  const chooseUnit = (data: PlanningTargetsResult, cls: string, unit: string) => {
    setUnitId(unit);
    const lessons =
      data.classes.find((c) => c.id === cls)?.units.find((u) => u.id === unit)?.lessons ?? [];
    setLessonId(defaultLesson(lessons, data.relatedExpectationIds)?.id ?? '');
    setPosition('end');
    setReplacing(null);
  };
  const chooseClass = (data: PlanningTargetsResult, cls: string) => {
    setClassId(cls);
    const unit = defaultUnit(data.classes.find((c) => c.id === cls) ?? null, data.item.subjectId);
    chooseUnit(data, cls, unit?.id ?? '');
  };

  const load = () =>
    startLoading(async () => {
      setLoadError(null);
      const result = await listPlanningTargets(itemId).catch(() => null);
      if (!result || !result.ok) {
        setLoadError(result?.error ?? 'network');
        return;
      }
      setTargets(result.data);
      const cls = defaultClass(
        result.data.classes,
        result.data.item.subjectId,
        result.data.item.gradeCodes,
      );
      if (cls) chooseClass(result.data, cls.id);
    });

  const cls = targets?.classes.find((c) => c.id === classId) ?? null;
  const units = cls ? orderUnits(cls.units, targets?.item.subjectId ?? null) : [];
  const unit = units.find((u) => u.id === unitId) ?? null;
  const lessons = unit?.lessons ?? [];
  const next = nextLesson(lessons);
  const lesson = lessons.find((l) => l.id === lessonId) ?? null;
  // A unit without lessons can only get a new one.
  const effectiveMode: PlanningMode = lessons.length ? mode : 'new';
  const positions = positionChoices(lessons);
  const chosenPosition = positions.find((p) => positionKey(p) === position) ?? positions[0]!;
  const lessonLabel = (l: PlanningLesson) =>
    l.id === next?.id
      ? t('lessonNext', { n: l.sequenceNumber, title: l.title })
      : l.done
        ? t('lessonDone', { n: l.sequenceNumber, title: l.title })
        : t('lesson', { n: l.sequenceNumber, title: l.title });
  const positionLabel = (p: NewLessonPosition) =>
    p.kind === 'end'
      ? t('positions.end')
      : p.kind === 'next'
        ? t('positions.next', { n: p.before.sequenceNumber, title: p.before.title })
        : t('positions.after', { n: p.lesson.sequenceNumber, title: p.lesson.title });

  const submitAttach = async (replace: boolean) => {
    if (!lesson) return;
    const result = await attach.run(itemId, lesson.id, replace);
    if (!result?.ok) return;
    if (result.data.status === 'confirm') {
      setReplacing(result.data.currentTitle ?? t('hiddenResource'));
      return;
    }
    const { classId: c, unitId: u, sequenceNumber } = result.data;
    setOpen(false);
    toast.success(t('attached', { n: sequenceNumber }), { action: showUnit(c, u) });
    router.refresh();
  };

  const submit = () => {
    if (effectiveMode === 'new') {
      if (unit) void add.run(itemId, unit.id, positionNumber(chosenPosition));
      return;
    }
    if (!lesson) return;
    const other = lesson.resource && lesson.resource.id !== itemId;
    if ((other || lesson.hasHiddenResource) && replacing === null) {
      setReplacing(lesson.resource?.title ?? t('hiddenResource'));
      return;
    }
    void submitAttach(replacing !== null);
  };

  const pending = attach.pending || add.pending;

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          if (!targets) load();
        }}
      >
        <CalendarPlus aria-hidden />
        {t('open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('title')} closeLabel={tCommon('close')}>
          {loading && !targets ? (
            <p role="status" className="text-sm text-slate-600">
              {tCommon('loading')}
            </p>
          ) : loadError ? (
            <div className="space-y-3">
              <Notice tone="danger">{errorText(loadError)}</Notice>
              <Button variant="secondary" onClick={load}>
                {tCommon('retry')}
              </Button>
            </div>
          ) : targets && !targets.classes.length ? (
            <p className="text-slate-700">{t('noClasses')}</p>
          ) : targets ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Field label={t('class')} htmlFor="planning-class">
                <Select
                  id="planning-class"
                  value={classId}
                  onChange={(e) => chooseClass(targets, e.target.value)}
                >
                  {targets.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {units.length ? (
                <Field label={t('unit')} htmlFor="planning-unit">
                  <Select
                    id="planning-unit"
                    value={unitId}
                    onChange={(e) => chooseUnit(targets, classId, e.target.value)}
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {t('unitOption', {
                          subject: u.subjectLabel,
                          title: u.title,
                          status: t(`unitStatus.${u.status}`),
                        })}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-sm text-slate-700">{t('noUnits')}</p>
              )}

              {unit ? (
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium text-slate-700">{t('mode')}</legend>
                  {(['attach', 'new'] as const).map((m) => (
                    <label
                      key={m}
                      className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800"
                    >
                      <input
                        type="radio"
                        name="planning-mode"
                        className="size-5"
                        checked={effectiveMode === m}
                        disabled={m === 'attach' && !lessons.length}
                        onChange={() => {
                          setMode(m);
                          setReplacing(null);
                        }}
                      />
                      {t(`modes.${m}`)}
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {unit && effectiveMode === 'attach' ? (
                <Field
                  label={t('lessonLabel')}
                  htmlFor="planning-lesson"
                  hint={
                    lesson?.resource && lesson.resource.id !== itemId
                      ? t('hasResource', { title: lesson.resource.title })
                      : undefined
                  }
                >
                  <Select
                    id="planning-lesson"
                    value={lessonId}
                    onChange={(e) => {
                      setLessonId(e.target.value);
                      setReplacing(null);
                    }}
                  >
                    {lessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {lessonLabel(l)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {unit && effectiveMode === 'new' ? (
                <Field label={t('position')} htmlFor="planning-position" hint={t('newHint')}>
                  <Select
                    id="planning-position"
                    value={positionKey(chosenPosition)}
                    onChange={(e) => setPosition(e.target.value)}
                  >
                    {positions.map((p) => (
                      <option key={positionKey(p)} value={positionKey(p)}>
                        {positionLabel(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {replacing !== null ? (
                <Notice tone="warning" role="alert">
                  {t('replaceConfirm', { title: replacing })}
                </Notice>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={pending || !unit || (effectiveMode === 'attach' && !lesson)}
                >
                  {effectiveMode === 'new'
                    ? t('submitNew')
                    : replacing !== null
                      ? t('submitReplace')
                      : lesson
                        ? t('submitAttach', { n: lesson.sequenceNumber })
                        : t('submitAttachNone')}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
