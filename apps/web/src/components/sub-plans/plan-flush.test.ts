import { describe, expect, it, vi } from 'vitest';
import { flushPlanEdits, registerPlanFlush } from './plan-flush';

describe('saving the plan editor’s changes before the AI preview', () => {
  it('waits for the editor of that plan, and only that plan', async () => {
    let saved = false;
    const flush = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      saved = true;
    });
    const other = vi.fn(async () => undefined);
    const unregister = registerPlanFlush('plan-a', flush);
    registerPlanFlush('plan-b', other);
    await flushPlanEdits('plan-a');
    expect(saved).toBe(true);
    expect(other).not.toHaveBeenCalled();
    unregister();
    await flushPlanEdits('plan-a');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('goes on when there is no editor or its save fails', async () => {
    await expect(flushPlanEdits('nobody')).resolves.toBeUndefined();
    registerPlanFlush('plan-c', () => Promise.reject(new Error('offline')));
    await expect(flushPlanEdits('plan-c')).resolves.toBeUndefined();
  });

  it('keeps a newer editor registered when an older one goes away', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const unregisterFirst = registerPlanFlush('plan-d', first);
    registerPlanFlush('plan-d', second);
    unregisterFirst();
    await flushPlanEdits('plan-d');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
