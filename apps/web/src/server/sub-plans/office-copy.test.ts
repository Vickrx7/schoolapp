import { composeSubPlan, subPlanV1Schema, type SubPlanV1 } from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { withClassManagementKey } from './office-copy';

const CLASS = '10000000-0000-4000-8000-000000000001';

const plan: SubPlanV1 = {
  schemaVersion: 1,
  date: '2026-10-21',
  part: 'full_day',
  window: { start: '08:45', end: '15:20' },
  split: '12:55',
  day: { kind: 'weekly', dayKey: 3 },
  classes: [{ classId: CLASS, name: '3e année', gradeLabels: ['3e année'], roomName: 'Local 101' }],
  groups: [],
  dayEvents: [],
  blocks: [],
  classNotes: [
    {
      classId: CLASS,
      arrival: 'Accueillez les élèves à la porte.',
      routines: null,
      classManagement: 'Signal de silence : levez la main.',
      dismissal: null,
      fallbackActivities: null,
      neighbour: null,
      team: [],
    },
  ],
  endOfDay: { time: '15:20', checklist: [] },
  faith: null,
  warnings: [],
  generator: { version: 'domain-1', generatedAt: '2026-10-01T10:00:00.000Z' },
};

/** What get_sub_plan_for_staff returns to office staff: the key removed from each class. */
function officeCopy(p: SubPlanV1): unknown {
  const copy = JSON.parse(JSON.stringify(p)) as { classNotes: Record<string, unknown>[] };
  for (const n of copy.classNotes) delete n.classManagement;
  return copy;
}

describe('the office’s copy of a plan', () => {
  it('does not read as a plan until the removed key is put back', () => {
    expect(subPlanV1Schema.safeParse(officeCopy(plan)).success).toBe(false);
    const parsed = subPlanV1Schema.parse(withClassManagementKey(officeCopy(plan)));
    expect(parsed.classNotes[0]).toMatchObject({
      arrival: 'Accueillez les élèves à la porte.',
      classManagement: null,
    });
    expect(JSON.stringify(composeSubPlan(parsed, { audience: 'office' }))).not.toContain(
      'Signal de silence',
    );
  });

  it('leaves a full copy (direction) and anything else as it is', () => {
    expect(withClassManagementKey(plan)).toEqual(plan);
    expect(withClassManagementKey(null)).toBeNull();
    expect(withClassManagementKey({ classNotes: 'x' })).toEqual({ classNotes: 'x' });
  });
});
