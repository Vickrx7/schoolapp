import { describe, expect, it } from 'vitest';
import { timelineState } from './timeline-state';

const blocks = [
  { key: 'a', start: '08:45', end: '08:55', title: 'Entrée' },
  { key: 'b', start: '08:55', end: '09:45', title: 'Français' },
  { key: 'c', start: '09:45', end: '10:35', title: 'Mathématiques' },
  { key: 'e', start: '11:15', end: '12:05', title: 'Français' },
  { key: 'f', start: '15:15', end: '15:20', title: 'Départ' },
];
const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe('« Maintenant » and « Ensuite »', () => {
  it('is shown on the plan date only', () => {
    expect(timelineState(blocks, '2026-10-14', '2026-10-13', at('10:00'))).toEqual({
      kind: 'otherDay',
    });
  });

  it('finds the block under way and the next one', () => {
    const state = timelineState(blocks, '2026-10-14', '2026-10-14', at('10:00'));
    expect(state).toMatchObject({ kind: 'during', now: { key: 'c' }, next: { key: 'e' } });
    // A block ends at its end time: the next one starts then.
    expect(timelineState(blocks, '2026-10-14', '2026-10-14', at('09:45'))).toMatchObject({
      now: { key: 'c' },
    });
  });

  it('between two blocks (a recess), shows only what comes next', () => {
    expect(timelineState(blocks, '2026-10-14', '2026-10-14', at('10:50'))).toEqual({
      kind: 'during',
      now: null,
      next: blocks[3],
    });
  });

  it('before the first block and after the last one', () => {
    expect(timelineState(blocks, '2026-10-14', '2026-10-14', at('07:30'))).toEqual({
      kind: 'before',
      next: blocks[0],
    });
    expect(timelineState(blocks, '2026-10-14', '2026-10-14', at('15:20'))).toEqual({
      kind: 'after',
    });
  });

  it('with overlapping blocks, the one that started last is under way', () => {
    const overlap = [
      { key: 'x', start: '09:00', end: '11:00', title: 'Sortie' },
      { key: 'y', start: '09:30', end: '10:00', title: 'Collation' },
      { key: 'z', start: '11:00', end: '12:00', title: 'Lecture' },
    ];
    expect(timelineState(overlap, 'd', 'd', at('09:40'))).toMatchObject({
      now: { key: 'y' },
      next: { key: 'z' },
    });
  });
});
