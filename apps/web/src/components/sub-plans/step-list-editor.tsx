'use client';

import type { SubPlanStepEdit } from '@lynx/domain';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/field';
import { MAX_CHECKLIST, MAX_STEPS, parseMinutes } from './edits';

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** A block's steps: minutes and text, reordered, added and removed. */
export function StepListEditor({
  idPrefix,
  steps,
  onChange,
}: {
  idPrefix: string;
  steps: SubPlanStepEdit[];
  onChange: (steps: SubPlanStepEdit[]) => void;
}) {
  const t = useTranslations('subPlan');
  const tCommon = useTranslations('common');
  const set = (i: number, patch: Partial<SubPlanStepEdit>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">{t('block.steps')}</p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-24">
                <Label htmlFor={`${idPrefix}-min-${i}`} className="text-xs">
                  {t('stepMinutes', { n: i + 1 })}
                </Label>
                <Input
                  id={`${idPrefix}-min-${i}`}
                  inputMode="numeric"
                  value={s.minutes ?? ''}
                  onChange={(e) => set(i, { minutes: parseMinutes(e.target.value) })}
                />
              </div>
              <div className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${tCommon('moveUp')} (${t('stepText', { n: i + 1 })})`}
                  disabled={i === 0}
                  onClick={() => onChange(move(steps, i, i - 1))}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${tCommon('moveDown')} (${t('stepText', { n: i + 1 })})`}
                  disabled={i === steps.length - 1}
                  onClick={() => onChange(move(steps, i, i + 1))}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('removeStep', { n: i + 1 })}
                  onClick={() => onChange(steps.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            </div>
            <Label htmlFor={`${idPrefix}-text-${i}`} className="sr-only">
              {t('stepText', { n: i + 1 })}
            </Label>
            <Textarea
              id={`${idPrefix}-text-${i}`}
              value={s.text}
              maxLength={1000}
              className="min-h-20"
              onChange={(e) => set(i, { text: e.target.value })}
            />
          </li>
        ))}
      </ol>
      {steps.length < MAX_STEPS ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...steps, { minutes: null, text: '' }])}
        >
          <Plus aria-hidden />
          {t('addStep')}
        </Button>
      ) : null}
    </div>
  );
}

/** The end-of-day checklist: one line per item. */
export function ChecklistEditor({
  idPrefix,
  items,
  onChange,
}: {
  idPrefix: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const t = useTranslations('subPlan');
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            <Label htmlFor={`${idPrefix}-${i}`} className="sr-only">
              {t('checklistItem', { n: i + 1 })}
            </Label>
            <Input
              id={`${idPrefix}-${i}`}
              value={item}
              maxLength={300}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('removeChecklistItem', { n: i + 1 })}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      {items.length < MAX_CHECKLIST ? (
        <Button variant="secondary" size="sm" onClick={() => onChange([...items, ''])}>
          <Plus aria-hidden />
          {t('addChecklistItem')}
        </Button>
      ) : null}
    </div>
  );
}
