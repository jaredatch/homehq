import { NextResponse } from 'next/server';
import { getAuthUrl, OAUTH_STATE_COOKIE } from '@/lib/google/oauth';

export function GET() {
  try {
    const state = crypto.randomUUID();
    const response = NextResponse.redirect(getAuthUrl(state));

    // CSRF protection: the callback must present this same state value.
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600, // 10 minutes — plenty for the consent screen
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build auth URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
