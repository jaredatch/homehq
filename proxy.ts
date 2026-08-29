import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  readSession,
  createSession,
  isAuthBypassed,
  sessionOpensBoard,
  shouldRenewSession,
  sessionCookieOptions,
  COOKIE_NAME,
} from '@/lib/auth/session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Dev-only auth bypass for local design work (headless screenshots + manual
  // reloads skip the PIN). See isAuthBypassed for the two guards on it; it
  // lives there so the server pages can't drift from this.
  if (isAuthBypassed()) {
    return NextResponse.next();
  }

  // Only the login page and PIN validation endpoint are public. Everything
  // else — including the OAuth routes — requires a session. Google's redirect
  // back to /api/oauth/callback is a top-level GET navigation, so the
  // SameSite=Lax session cookie is sent and the gate holds.
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Which board the URL is asking for, when the path says so. Carried into the
  // login redirect so a path-only install (`/b/<slug>`, no subdomains) shows
  // the right board's name and checks the right PIN — on a host-routed install
  // the login page resolves it from the hostname instead.
  const requestedBoard = pathname.match(/^\/b\/([^/]+)/)?.[1];
  const loginUrl = new URL(
    requestedBoard ? `/login?board=${requestedBoard}` : '/login',
    request.url
  );

  const unauthorized = () =>
    pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      : NextResponse.redirect(loginUrl);

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.COOKIE_SECRET;

  if (!token || !secret) {
    return unauthorized();
  }

  const session = await readSession(token, secret);
  if (!session) {
    return unauthorized();
  }

  // A board-stamped session is for one panel, not for the install itself.
  // /setup and the OAuth routes can disconnect or re-consent the household's
  // Google account — the widest blast radius in the app — and a bedroom panel
  // has no business there. The family PIN (unstamped) still reaches them.
  if (session.board && (pathname.startsWith('/setup') || pathname.startsWith('/api/oauth'))) {
    return unauthorized();
  }

  // A session stamped with one board's PIN doesn't open another board. The
  // slug is right there in the path, so this needs no config — which matters,
  // because the proxy runs on the Edge runtime and can't read config.json off
  // disk. `/` is checked by the page instead, where the host IS resolvable.
  if (requestedBoard && !sessionOpensBoard(session, decodeURIComponent(requestedBoard))) {
    return unauthorized();
  }

  const response = NextResponse.next();

  // Sliding renewal so the always-on kiosk never gets logged out. The board
  // stamp has to be carried over: re-minting without it would quietly widen a
  // kid's session into a family one on its seventh day.
  if (shouldRenewSession(session)) {
    response.cookies.set(
      COOKIE_NAME,
      await createSession(secret, session.board),
      sessionCookieOptions()
    );
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
