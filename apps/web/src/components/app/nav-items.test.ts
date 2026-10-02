import { describe, expect, it } from 'vitest';
import { PHONE_BAR_MAX, isNavActive, phoneBar, type NavKey } from './nav-items';

const items = (...keys: NavKey[]) => keys.map((key) => ({ key }));
const keys = (list: { key: NavKey }[]) => list.map((i) => i.key);

describe('the phone navigation bar', () => {
  it('shows every item when they fit', () => {
    const teacher = items('today', 'classes', 'library', 'calendar', 'profile');
    expect(phoneBar(teacher)).toEqual({ bar: teacher, more: [] });
    const office = items('substitutes', 'calendar', 'school', 'profile');
    expect(phoneBar(office)).toEqual({ bar: office, more: [] });
    // A board's reviewer with no school: « Ressources », « Calendrier » and « Profil ».
    const reviewer = items('library', 'calendar', 'profile');
    expect(phoneBar(reviewer)).toEqual({ bar: reviewer, more: [] });
  });

  it('leaves « Suppléances » out for a teaching principal, keeping École and Profil', () => {
    const all = items(
      'today',
      'classes',
      'substitutes',
      'library',
      'calendar',
      'school',
      'profile',
    );
    const { bar, more } = phoneBar(all);
    expect(bar).toHaveLength(PHONE_BAR_MAX);
    expect(keys(bar)).toEqual(['today', 'classes', 'library', 'calendar', 'school', 'profile']);
    expect(more).toEqual([]);
  });

  it('keeps Phase 3’s bar where the library is not licensed', () => {
    const all = items(
      'today',
      'classes',
      'substitutes',
      'differentiate',
      'calendar',
      'school',
      'profile',
    );
    expect(keys(phoneBar(all).bar)).toEqual([
      'today',
      'classes',
      'differentiate',
      'calendar',
      'school',
      'profile',
    ]);
  });

  it('shows the first five and « Plus » when even that is too many', () => {
    const all = items(
      'today',
      'classes',
      'substitutes',
      'library',
      'differentiate',
      'calendar',
      'school',
      'profile',
    );
    const { bar, more } = phoneBar(all);
    // Five items and « Plus »: six places.
    expect(keys(bar)).toEqual(['today', 'classes', 'library', 'differentiate', 'calendar']);
    expect(keys(more)).toEqual(['substitutes', 'school', 'profile']);
    expect(bar.length + 1).toBe(PHONE_BAR_MAX);
    // Every item is reachable, once.
    expect([...keys(bar), ...keys(more)].sort()).toEqual(keys(all).sort());
  });
});

describe('the bar with « Direction » and « Conseil » (D-118)', () => {
  it('gives a principal who does not teach five items: the dashboard links « Suppléances »', () => {
    const principal = items('direction', 'substitutes', 'library', 'calendar', 'school', 'profile');
    expect(keys(phoneBar(principal).bar)).toEqual([
      'direction',
      'library',
      'calendar',
      'school',
      'profile',
    ]);
    expect(phoneBar(principal).more).toEqual([]);
    // Without the library: « Suppléances » fits.
    const smaller = items('direction', 'substitutes', 'calendar', 'school', 'profile');
    expect(phoneBar(smaller)).toEqual({ bar: smaller, more: [] });
  });

  it('gives a teaching vice-principal the first five and « Plus »', () => {
    const all = items(
      'today',
      'classes',
      'direction',
      'substitutes',
      'library',
      'calendar',
      'school',
      'profile',
    );
    const { bar, more } = phoneBar(all);
    expect(keys(bar)).toEqual(['today', 'classes', 'direction', 'library', 'calendar']);
    expect(keys(more)).toEqual(['substitutes', 'school', 'profile']);
    expect(bar.length + 1).toBe(PHONE_BAR_MAX);
  });

  it('gives a board admin who is not a reviewer three items', () => {
    const admin = items('calendar', 'board', 'profile');
    expect(phoneBar(admin)).toEqual({ bar: admin, more: [] });
    // The demo board's admin also reviews resources: four.
    const reviewer = items('library', 'calendar', 'board', 'profile');
    expect(phoneBar(reviewer)).toEqual({ bar: reviewer, more: [] });
  });

  it('puts « Journal d’audit » under « Direction », else « Conseil » (Phase 6 review)', () => {
    const direction = { key: 'direction' as const, href: '/direction' };
    const board = { key: 'board' as const, href: '/board' };
    const principal: NavKey[] = ['direction', 'library', 'calendar', 'school', 'profile'];
    const admin: NavKey[] = ['library', 'calendar', 'board', 'profile'];
    expect(isNavActive(direction, '/audit', principal)).toBe(true);
    expect(isNavActive(board, '/audit', admin)).toBe(true);
    expect(isNavActive(board, '/audit', [...principal, 'board'])).toBe(false);
    expect(isNavActive({ key: 'calendar', href: '/calendar' }, '/audit', admin)).toBe(false);
  });

  it('keeps « Direction » and « Conseil » active on their sub-pages', () => {
    expect(isNavActive({ key: 'board', href: '/board' }, '/board/staff/abc')).toBe(true);
    expect(isNavActive({ key: 'direction', href: '/direction' }, '/direction')).toBe(true);
    expect(isNavActive({ key: 'board', href: '/board' }, '/boards')).toBe(false);
  });
});

describe('the active item', () => {
  const library = { key: 'library' as const, href: '/library' };
  const today = { key: 'today' as const, href: '/today' };

  it('is the page or one of its sub-pages', () => {
    expect(isNavActive(library, '/library')).toBe(true);
    expect(isNavActive(library, '/library/items/abc')).toBe(true);
    expect(isNavActive(today, '/today')).toBe(true);
    expect(isNavActive(today, '/todayx')).toBe(false);
    expect(isNavActive(library, '/librarything')).toBe(false);
  });

  it('keeps « Ressources » highlighted in « Texte différencié »', () => {
    expect(isNavActive(library, '/differentiate')).toBe(true);
    expect(isNavActive(library, '/differentiate/levels')).toBe(true);
    expect(isNavActive(today, '/differentiate')).toBe(false);
    expect(isNavActive({ key: 'differentiate', href: '/differentiate' }, '/differentiate/x')).toBe(
      true,
    );
  });
});
