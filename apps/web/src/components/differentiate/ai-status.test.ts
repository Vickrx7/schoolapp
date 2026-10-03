import { describe, expect, it } from 'vitest';
import { aiStatus } from './ai-status';

describe('AI status shown to staff', () => {
  it('follows the school’s switch when the board allows AI', () => {
    expect(aiStatus({ aiEnabled: true, boardAllows: true })).toBe('on');
    expect(aiStatus({ aiEnabled: false, boardAllows: true })).toBe('off');
  });

  it('says the board turned it off, even when the school’s switch is on', () => {
    expect(aiStatus({ aiEnabled: true, boardAllows: false })).toBe('boardOff');
    expect(aiStatus({ aiEnabled: false, boardAllows: false })).toBe('boardOff');
  });
});
