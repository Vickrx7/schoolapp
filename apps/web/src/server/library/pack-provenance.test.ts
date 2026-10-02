import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import { FINGERPRINT_LENGTH, packLabelsById, packProvenanceView } from './pack-provenance';

const SHA = '3fa4c1d2e9b0' + 'a'.repeat(52);

describe('pack provenance (D-100)', () => {
  it('shows the declared publisher, the import date and the first 12 characters of the file hash', () => {
    expect(
      packProvenanceView({
        publisher: '  IP Lynx ',
        imported_at: '2026-11-03T14:00:00+00:00',
        file_sha256: SHA,
      }),
    ).toEqual({
      publisher: 'IP Lynx',
      importedAt: '2026-11-03T14:00:00+00:00',
      fingerprint: '3fa4c1d2e9b0',
    });
    expect(FINGERPRINT_LENGTH).toBe(12);
  });

  it('has no fingerprint for a pack a seed loaded, and nothing without a publisher', () => {
    expect(
      packProvenanceView({ publisher: 'IP Lynx', imported_at: '2026-09-29', file_sha256: null }),
    ).toMatchObject({ fingerprint: null });
    expect(
      packProvenanceView({ publisher: 'IP Lynx', imported_at: '2026-09-29', file_sha256: 'abc' }),
    ).toMatchObject({ fingerprint: null });
    expect(
      packProvenanceView({ publisher: ' ', imported_at: '2026-09-29', file_sha256: SHA }),
    ).toBeNull();
    expect(packProvenanceView(null)).toBeNull();
  });

  it('labels the items that came from a pack, for the review queue', () => {
    const labels = packLabelsById([
      { id: 'a', content_packs: { title: 'Ressources IP Lynx', version: '2026.2' } },
      { id: 'b', content_packs: null },
    ]);
    expect([...labels]).toEqual([['a', { title: 'Ressources IP Lynx', version: '2026.2' }]]);
    expect(packLabelsById(null).size).toBe(0);
  });

  it('has its messages in French and English', () => {
    for (const messages of [fr, en]) {
      expect(Object.keys(messages.libraryPacks).sort()).toEqual([
        'badge',
        'provenance',
        'provenanceWithoutFingerprint',
      ]);
    }
    expect(fr.libraryPacks.provenance).toBe(
      'Éditeur déclaré\u00a0: {publisher} · importé le {date} · empreinte {hash}',
    );
  });
});
