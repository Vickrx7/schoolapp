import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth/confirm', '/auth/no-access'];

/**
 * The substitute portal (no account; DECISIONS D-049). Public, and handled before the Supabase
 * client exists, so a staff session cookie in the same browser is never read or refreshed there.
 */
const PORTAL_PATHS = ['/suppleance', '/s'];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out visitors to
 * the login page. This is only an optimistic check: pages and server actions verify the
 * session again, and Row Level Security enforces access in the database.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PORTAL_PATHS.some((p) => under(path, p))) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
        },
      },
    },
  );

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
