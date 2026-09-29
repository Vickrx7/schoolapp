import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import {
  LINEAGE_MESSAGES_NAMESPACE,
  LINEAGE_MESSAGE_KEYS,
  lineageView,
  type LineageRow,
} from './lineage-view';

const parentId = '3b9f6c2e-8a1d-4e5f-9b7c-2d4e6f8a0b1c';

const available = (patch: Partial<LineageRow>): LineageRow => ({
  parentId,
  title: 'Le huard, oiseau des lacs',
  available: true,
  creditKind: 'author',
  creditName: 'Mme Tremblay',
  schoolName: null,
  packTitle: null,
  ...patch,
});

describe('lineageView (W7)', () => {
  it('is null for an item that is not an adaptation', () => {
    expect(lineageView(null)).toBeNull();
    expect(lineageView(undefined)).toBeNull();
  });

  it('credits a teacher by name, with the school for a school-scoped original', () => {
    expect(lineageView(available({}))).toEqual({
      basedOn: { key: 'basedOn', values: { title: 'Le huard, oiseau des lacs' } },
      href: `/library/items/${parentId}`,
      credit: { key: 'by', values: { name: 'Mme Tremblay' } },
    });
    expect(lineageView(available({ schoolName: 'É.É.C. Saint-Exemple' }))?.credit).toEqual({
      key: 'byAtSchool',
      values: { name: 'Mme Tremblay', school: 'É.É.C. Saint-Exemple' },
    });
  });

  it('credits the board for its own resources', () => {
    const view = lineageView(available({ creditKind: 'board', creditName: null }));
    expect(view?.credit).toEqual({ key: 'board' });
    expect(view?.href).toBe(`/library/items/${parentId}`);
  });

  it('credits the pack for a resource from a content pack', () => {
    expect(
      lineageView(
        available({ creditKind: 'pack', creditName: null, packTitle: 'Ressources IP Lynx' }),
      )?.credit,
    ).toEqual({ key: 'pack', values: { title: 'Ressources IP Lynx' } });
  });

  it('shows only the copied title when the original is not available', () => {
    const view = lineageView({
      parentId: null,
      title: 'Le huard, oiseau des lacs',
      available: false,
      creditKind: null,
      creditName: null,
      schoolName: null,
      packTitle: null,
    });
    expect(view).toEqual({
      basedOn: { key: 'basedOn', values: { title: 'Le huard, oiseau des lacs' } },
      href: null,
      credit: { key: 'unavailable' },
    });
  });

  it('never names or links an original the viewer cannot use, whatever the row holds', () => {
    const view = lineageView(available({ available: false, schoolName: 'É.É.C. Saint-Exemple' }));
    expect(view?.href).toBeNull();
    expect(view?.credit).toEqual({ key: 'unavailable' });
    expect(JSON.stringify(view)).not.toMatch(/Tremblay|Saint-Exemple/);
  });

  it('says « une autre ressource » when no title was copied', () => {
    expect(lineageView(available({ available: false, parentId: null, title: null }))).toEqual({
      basedOn: { key: 'basedOnUntitled' },
      href: null,
      credit: { key: 'unavailable' },
    });
    expect(lineageView(available({ title: '   ' }))?.basedOn).toEqual({ key: 'basedOnUntitled' });
  });

  it('names no one rather than guessing', () => {
    expect(lineageView(available({ creditName: null }))?.credit).toBeNull();
    expect(lineageView(available({ creditName: '  ' }))?.credit).toBeNull();
    expect(lineageView(available({ creditKind: 'pack', packTitle: null }))?.credit).toBeNull();
    expect(lineageView(available({ creditKind: 'robot' }))?.credit).toBeNull();
    expect(lineageView(available({ creditKind: null }))?.credit).toBeNull();
  });

  it('links only to a well-formed item id', () => {
    expect(lineageView(available({ parentId: '../../admin' }))?.href).toBeNull();
    expect(lineageView(available({ parentId: null }))?.href).toBeNull();
  });

  it('uses only its own message keys', () => {
    const keys = new Set<string>();
    const rows: LineageRow[] = [
      available({}),
      available({ schoolName: 'École' }),
      available({ creditKind: 'board' }),
      available({ creditKind: 'pack', packTitle: 'P' }),
      available({ available: false, title: null }),
    ];
    for (const row of rows) {
      const view = lineageView(row)!;
      keys.add(view.basedOn.key);
      if (view.credit) keys.add(view.credit.key);
    }
    expect([...keys].sort()).toEqual([...LINEAGE_MESSAGE_KEYS].sort());
  });

  // Runs once the integrator adds the proposed strings to messages/*.json.
  const namespace = (fr as Record<string, unknown>)[LINEAGE_MESSAGES_NAMESPACE];
  it.skipIf(namespace === undefined)('has every key in both catalogues', () => {
    for (const catalogue of [fr, en] as Record<string, Record<string, unknown>>[]) {
      const messages = catalogue[LINEAGE_MESSAGES_NAMESPACE] ?? {};
      for (const key of LINEAGE_MESSAGE_KEYS) {
        expect(typeof messages[key], `${LINEAGE_MESSAGES_NAMESPACE}.${key}`).toBe('string');
      }
    }
  });
});
