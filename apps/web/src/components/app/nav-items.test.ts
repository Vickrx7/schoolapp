import { describe, expect, it } from 'vitest';
import { PHONE_BAR_MAX, phoneBarItems, type NavKey } from './nav-items';

const items = (...keys: NavKey[]) => keys.map((key) => ({ key }));
const keys = (list: { key: NavKey }[]) => list.map((i) => i.key);

describe('the phone navigation bar', () => {
  it('shows every item when they fit', () => {
    const teacher = items('today', 'classes', 'differentiate', 'calendar', 'profile');
    expect(phoneBarItems(teacher)).toEqual(teacher);
    const office = items('substitutes', 'calendar', 'school', 'profile');
    expect(phoneBarItems(office)).toEqual(office);
  });

  it('leaves « Suppléances » out for a teaching principal, keeping École and Profil', () => {
    const all = items(
      'today',
      'classes',
      'substitutes',
      'differentiate',
      'calendar',
      'school',
      'profile',
    );
    const bar = phoneBarItems(all);
    expect(bar).toHaveLength(PHONE_BAR_MAX);
    expect(keys(bar)).toEqual([
      'today',
      'classes',
      'differentiate',
      'calendar',
      'school',
      'profile',
    ]);
  });
});
