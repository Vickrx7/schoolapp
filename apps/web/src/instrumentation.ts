import type { Instrumentation } from 'next';

/**
 * Error capture for the web server (DECISIONS D-111). `register` runs once when the server
 * starts: in production, everything printed on the console becomes a scrubbed log line.
 * `onRequestError` logs a failed request with its route template and type and the scrubbed
 * error, never its address, headers or anything the request carried. No third-party service.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { installServerLogging } = await import('./server/observability');
  installServerLogging();
}

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportServerError } = await import('./server/observability');
  reportServerError(error, { routePath: context.routePath, routeType: context.routeType });
};
