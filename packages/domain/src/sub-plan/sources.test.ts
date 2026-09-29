import { describe, expect, it } from 'vitest';
import { subPlanSourcesSchema } from './sources';
import { C3, block, isabelleSources } from './test-fixtures';

describe('subPlanSourcesSchema', () => {
  it('reads empty lists sent as null and normalizes times', () => {
    const raw = { ...isabelleSources(), anchors: null, siblings: undefined, events: null };
    const sources = subPlanSourcesSchema.parse(raw);
    expect(sources.anchors).toEqual([]);
    expect(sources.siblings).toEqual([]);
    expect(sources.events).toEqual([]);
    expect(sources.blocks.find((b) => b.id === block(C3, 1, '08:45'))?.startTime).toBe('08:45');
  });

  it('parses school settings leniently', () => {
    const sources = subPlanSourcesSchema.parse(isabelleSources());
    expect(sources.school.settings).toMatchObject({
      contact: { officePhone: '555-0100' },
      dayEnd: '15:20',
      substitute: { accessFrom: '05:00', halfDaySplit: null },
    });
  });

  it('strips keys it doesn’t know and refuses malformed ids', () => {
    const raw = isabelleSources();
    const withExtras = {
      ...raw,
      students: raw.students!.map((s) => ({ ...s, firstName: 'Samuel' })),
      classes: raw.classes!.map((c) => ({ ...c, secret: 'x' })),
    };
    const sources = subPlanSourcesSchema.parse(withExtras);
    expect(JSON.stringify(sources)).not.toContain('Samuel');
    expect(sources.classes[0]).not.toHaveProperty('secret');
    expect(
      subPlanSourcesSchema.safeParse({ ...raw, teacher: { ...raw.teacher!, id: 'isabelle' } })
        .success,
    ).toBe(false);
  });
});
