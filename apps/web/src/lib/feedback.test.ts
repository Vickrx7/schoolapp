import { describe, expect, it } from 'vitest';
import { deviceClass } from './feedback';

describe('the device a comment comes from (D-116)', () => {
  it('reads the window’s width', () => {
    expect(deviceClass(360)).toBe('phone');
    expect(deviceClass(412)).toBe('phone');
    expect(deviceClass(712)).toBe('tablet');
    expect(deviceClass(1023)).toBe('tablet');
    expect(deviceClass(1280)).toBe('desktop');
  });
});
