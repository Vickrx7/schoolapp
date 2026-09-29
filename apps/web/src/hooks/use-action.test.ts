import { describe, expect, it } from 'vitest';
import fr from '../../messages/fr-CA.json';
import { KNOWN_ERRORS } from './use-action';

type Tree = { [key: string]: string | Tree };

const lookup = (tree: Tree, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree);

describe('known action errors', () => {
  it('each has a message under errors', () => {
    for (const key of KNOWN_ERRORS) {
      expect(typeof lookup(fr.errors as Tree, key), key).toBe('string');
    }
  });

  it('include the class mode and library growth errors (Phase 5)', () => {
    for (const key of [
      'classSessionOpen',
      'classSessionChanged',
      'classSessionNoMore',
      'classSessionEnded',
      'classModeNotPlayable',
      'classPortalNotConfigured',
      'libraryRateOwn',
      'libraryRateNotApproved',
      'libraryRemixArchived',
      'libraryRemixLicence',
      'libraryShareCap',
    ]) {
      expect(KNOWN_ERRORS.has(key), key).toBe(true);
    }
  });
});
