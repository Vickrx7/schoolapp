'use client';

import type { DateWindow } from '@lynx/domain';
import { CalendarPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { UnitPlanDialog, type PlanWeek, type PlannedUnit } from './unit-plan-dialog';

type Open = (target: PlannedUnit | 'new', from: HTMLElement) => void;

const OpenContext = createContext<Open | null>(null);

/** A unit's version: its dialog starts again from the saved values when they change. */
const versionOf = (u: PlannedUnit) =>
  [u.id, u.title, u.description ?? '', u.startsOn ?? '', u.endsOn ?? '', ...u.expectationIds].join(
    '|',
  );

/**
 * « Mon année »'s planning dialogs (DECISIONS D-126): « Planifier une unité » and one
 * « Planification de l'unité » shared by every unit on the page (the grid, the month list and
 * the lists below), so the year's weeks are sent once. The focus goes back to the button that
 * opened it.
 */
export function YearPlanDialogs({
  classId,
  subjects,
  weeks,
  year,
  children,
}: {
  classId: string;
  subjects: { id: string; label: string }[];
  weeks: PlanWeek[];
  year: DateWindow;
  children: ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const [unit, setUnit] = useState<PlannedUnit | null>(null);
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback<Open>((target, from) => {
    opener.current = from;
    if (target === 'new') {
      setCreating(true);
    } else {
      setUnit(target);
      setEditing(true);
    }
  }, []);
  const backToOpener = (event: Event) => {
    if (opener.current?.isConnected) {
      event.preventDefault();
      opener.current.focus();
    }
  };

  return (
    <OpenContext.Provider value={open}>
      {children}
      <UnitPlanDialog
        classId={classId}
        unit={null}
        subjects={subjects}
        weeks={weeks}
        year={year}
        showOpenUnit
        open={creating}
        onOpenChange={setCreating}
        onCloseAutoFocus={backToOpener}
      />
      {unit ? (
        <UnitPlanDialog
          key={versionOf(unit)}
          classId={classId}
          unit={unit}
          weeks={weeks}
          year={year}
          showOpenUnit
          open={editing}
          onOpenChange={setEditing}
          onCloseAutoFocus={backToOpener}
        />
      ) : null}
    </OpenContext.Provider>
  );
}

/** A button that opens a unit's « Planification de l'unité » (a cell, a row of the lists). */
export function UnitPlanButton({
  unit,
  children,
  ...props
}: { unit: PlannedUnit } & Omit<ComponentProps<'button'>, 'onClick' | 'type'>) {
  const open = useContext(OpenContext);
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(e) => open?.(unit, e.currentTarget)}
      {...props}
    >
      {children}
    </button>
  );
}

/** « Planifier une unité ». */
export function PlanUnitButton({
  variant = 'primary',
  children,
}: {
  variant?: 'primary' | 'secondary';
  children?: ReactNode;
}) {
  const open = useContext(OpenContext);
  const t = useTranslations('yearPlan.dialog');
  return (
    <Button
      variant={variant}
      aria-haspopup="dialog"
      onClick={(e) => open?.('new', e.currentTarget)}
    >
      <CalendarPlus aria-hidden />
      {children ?? t('newTitle')}
    </Button>
  );
}
