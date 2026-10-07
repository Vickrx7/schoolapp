import { originalConsole } from '@lynx/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isClientAbort, reportServerError } from './observability';

/**
 * The web server's line for a failed request (DECISIONS D-111): an error line with the route
 * template and the scrubbed error; a browser that left while the page was streaming is not a
 * fault, so it is an info line without the error.
 */
describe('reportServerError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const capture = () => ({
    errors: vi.spyOn(originalConsole, 'error').mockImplementation(() => undefined),
    lines: vi.spyOn(originalConsole, 'log').mockImplementation(() => undefined),
  });
  const parsed = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

  it('logs a failure as an error with its route, type and scrubbed error', () => {
    const { errors, lines } = capture();
    const error = Object.assign(new Error('could not save isabelle@ecole.ca'), {
      digest: '2338492845',
    });
    reportServerError(error, { routePath: '/classes/[classId]/students', routeType: 'render' });
    expect(lines).not.toHaveBeenCalled();
    expect(parsed(errors)).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'request failed',
        route: '/classes/[classId]/students',
        type: 'render',
        error: expect.objectContaining({
          digest: '2338492845',
          message: 'could not save [courriel]',
        }),
      }),
    ]);
  });

  it('logs a browser that left mid-stream as info, without the error', () => {
    const { errors, lines } = capture();
    const abort = Object.assign(new Error('The destination stream closed early.'), {
      digest: '2503691484',
    });
    reportServerError(abort, { routePath: '/direction', routeType: 'render' });
    expect(errors).not.toHaveBeenCalled();
    expect(parsed(lines)).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'request ended by the browser',
        route: '/direction',
        type: 'render',
      }),
    ]);
    expect(parsed(lines)[0]).not.toHaveProperty('error');
  });

  it('knows a client abort from a real failure', () => {
    expect(isClientAbort(new Error('The destination stream closed early.'))).toBe(true);
    // Inside the server, these are faults: the database or Auth went away.
    expect(isClientAbort(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false);
    expect(isClientAbort(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toBe(
      false,
    );
    expect(isClientAbort(new Error('The destination stream closed early'))).toBe(false);
    expect(isClientAbort(new Error('permission denied for table users'))).toBe(false);
    expect(isClientAbort('The destination stream closed early.')).toBe(false);
    expect(isClientAbort(null)).toBe(false);
  });
});
