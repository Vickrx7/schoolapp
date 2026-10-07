import { describe, expect, it } from 'vitest';
import { segmentMessage } from './ai-preview';

describe('segmentMessage', () => {
  it('marks every replaced name, longest first and as whole words', () => {
    const message = 'Pour Élève A et Élève AB, avec Adulte A. Élève ABC reste.';
    expect(
      segmentMessage(message, [
        { placeholder: 'Élève A' },
        { placeholder: 'Élève AB' },
        { placeholder: 'Adulte A' },
      ]),
    ).toEqual([
      { text: 'Pour ' },
      { text: 'Élève A', placeholder: 'Élève A' },
      { text: ' et ' },
      { text: 'Élève AB', placeholder: 'Élève AB' },
      { text: ', avec ' },
      { text: 'Adulte A', placeholder: 'Adulte A' },
      { text: '. Élève ABC reste.' },
    ]);
  });

  it('keeps a text without replacements whole', () => {
    expect(segmentMessage('Aucun nom.', [])).toEqual([{ text: 'Aucun nom.' }]);
    expect(segmentMessage('', [])).toEqual([]);
  });
});
