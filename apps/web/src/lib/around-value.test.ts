import { describe, expect, it } from 'vitest';
import { aroundValue, labelledByIds } from './around-value';

const ids = { before: 'b', value: 'v', after: 'a' };

describe('aroundValue', () => {
  it('splits a message around its value, in either language', () => {
    expect(aroundValue((text) => `Explication : ${text}`)).toEqual({
      before: 'Explication : ',
      after: '',
    });
    expect(aroundValue((text) => `Monter « ${text} »`)).toEqual({
      before: 'Monter « ',
      after: ' »',
    });
    expect(aroundValue((text) => `Move “${text}” up`)).toEqual({ before: 'Move “', after: '” up' });
  });

  it('keeps a message without the value whole', () => {
    expect(aroundValue(() => 'Indice')).toEqual({ before: 'Indice', after: '' });
  });

  it('names a control by the parts that hold words and the value', () => {
    expect(labelledByIds({ before: 'Réponse B : ', after: '' }, ids)).toBe('b v');
    expect(labelledByIds({ before: 'Move “', after: '” up' }, ids)).toBe('b v a');
    expect(labelledByIds({ before: '', after: ' ' }, ids)).toBe('v');
  });
});
