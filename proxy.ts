import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  readSession,
  createSession,
  shouldRenewSession,
  sessionCookieOptions,
  COOKIE_NAME,
} from '@/lib/auth/session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Dev-only auth bypass for local design work (headless screenshots + manual
  // reloads skip the PIN). Doubly guarded: requires BOTH a non-production build
  // AND an explicit opt-in flag, so it can never weaken the gate in production
  // even if DEV_AUTH_BYPASS leaks into a prod environment.
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS === '1') {
    return NextResponse.next();
  }

  // Only the login page and PIN validation endpoint are public. Everything
  // else — including the OAuth routes — requires a session. Google's redirect
  // back to /api/oauth/callback is a top-level GET navigation, so the
  // SameSite=Lax session cookie is sent and the gate holds.
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const unauthorized = () =>
    pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.COOKIE_SECRET;

  if (!token || !secret) {
    return unauthorized();
  }

  const session = await readSession(token, secret);
  if (!session) {
    return unauthorized();
  }

  const response = NextResponse.next();

  // Sliding renewal so the always-on kiosk never gets logged out.
  if (shouldRenewSession(session)) {
    response.cookies.set(COOKIE_NAME, await createSession(secret), sessionCookieOptions());
  }

  return response;
}

export const config = {
  // `fonts/` is excluded deliberately. Files under public/ are NOT covered by
  // the _next/static exclusion, so the vendored emoji slices were being gated —
  // and because next.config stamps them `public, max-age=1y, immutable`, that
  // header landed on the 307 redirect and Cloudflare cached the REDIRECT at the
  // edge for a year, serving it even to the authenticated kiosk. A font is not
  // a secret; keeping it out of the gate is what makes the cache header honest.
  // Never visible in dev: DEV_AUTH_BYPASS returns before the matcher matters.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|fonts/).*)'],
};
