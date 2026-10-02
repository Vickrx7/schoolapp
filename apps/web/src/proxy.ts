import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SURFACE_HEADER, surfaceOf, type Surface } from './lib/surface';
import { serverEnv } from './server/env';

/**
 * Pages for signed-out visitors too. « Confidentialité et conditions » (DECISIONS D-110) is
 * linked from the login page and the substitute portal.
 */
const PUBLIC_PATHS = ['/login', '/auth/confirm', '/auth/no-access', '/confidentialite'];

/**
 * Health checks for monitors and the error reports of browsers (D-111, D-112): public, never
 * cached, and handled before the Supabase client exists (no session is read or refreshed).
 */
const OPERATIONS_PATHS = ['/api/health', '/api/client-error'];

/**
 * The substitute portal (no account; DECISIONS D-049). Public, and handled before the Supabase
 * client exists, so a staff session cookie in the same browser is never read or refreshed there.
 */
const PORTAL_PATHS = ['/suppleance', '/s'];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Continues with the request's (possibly updated) headers and the surface header set, whatever
 * the client sent in it (lib/surface.ts).
 */
function forward(request: NextRequest, surface: Surface): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(SURFACE_HEADER, surface);
  return NextResponse.next({ request: { headers } });
}

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out visitors to
 * the login page. This is only an optimistic check: pages and server actions verify the
 * session again, and Row Level Security enforces access in the database.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Class devices (« Quiz sur les appareils », no account; DECISIONS D-083, D-090): public, and
  // handled before the Supabase client exists, like the substitute portal.
  if (surfaceOf(path) === 'jouer') return forward(request, 'jouer');
  if (PORTAL_PATHS.some((p) => under(path, p))) return forward(request, 'app');
  if (OPERATIONS_PATHS.some((p) => under(path, p))) return forward(request, 'app');

  let response = forward(request, 'app');

  // Read at run time on the server (DECISIONS D-113), never inlined into the build.
  const env = serverEnv();
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward(request, 'app');
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => under(path, p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = path === '/' ? '' : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (user && path === '/login') {
    // « Aujourd'hui » sends whoever does not teach to their own landing page (landingFor, D-118).
    const url = request.nextUrl.clone();
    url.pathname = '/today';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|manifest.webmanifest|.*\\.(?:png|svg|jpg|webp)$).*)',
  ],
};
