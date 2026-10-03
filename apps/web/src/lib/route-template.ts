/**
 * A page's address reduced to its route (DECISIONS D-111), for error reports: ids become `[id]`
 * (UUIDs and runs of 6 digits or more) and any other segment that does not look like one of the
 * app's own route names (lowercase words and dashes) becomes `[x]`, so a report never carries
 * what someone typed into the address bar. The query and the fragment (where substitute codes
 * and class links travel) are dropped. Pure, so the browser and the server both use it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_DIGITS = /^\d{6,}$/;
/** The app's static segments: `classes`, `class-mode`, `no-access`, `_next`, `api`… */
const ROUTE_NAME = /^[a-z_][a-z0-9_-]{0,39}$/;
/** A segment already written as a template (`[classId]`), as Next reports it. */
const TEMPLATE = /^\[{1,2}(?:\.\.\.)?[A-Za-z]+\]{1,2}$/;
/** Route groups in Next's own route paths: `(app)`, `(projector)`. */
const GROUP = /^\([a-z-]+\)$/;
const MAX_SEGMENTS = 12;

export function routeTemplate(pathname: string): string {
  const path = String(pathname ?? '').split(/[?#]/, 1)[0] ?? '';
  const segments = path.split('/').filter(Boolean).slice(0, MAX_SEGMENTS);
  const template = segments.map((segment) => {
    let value = segment;
    try {
      value = decodeURIComponent(segment);
    } catch {
      // Malformed escapes stay as they are, and fail the checks below.
    }
    if (UUID.test(value) || LONG_DIGITS.test(value)) return '[id]';
    if (TEMPLATE.test(value) || GROUP.test(value)) return value;
    if (ROUTE_NAME.test(value) && !/\d{4,}/.test(value)) return value;
    return '[x]';
  });
  return `/${template.join('/')}`;
}
