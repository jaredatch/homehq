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
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
