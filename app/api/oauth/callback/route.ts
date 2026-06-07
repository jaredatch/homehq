import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exchangeCode, OAUTH_STATE_COOKIE } from '@/lib/google/oauth';
import { saveToken } from '@/lib/db/tokens';

function redirectToSetup(request: NextRequest, query: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/setup?${query}`, request.url));
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (error) {
    return redirectToSetup(request, `error=${encodeURIComponent(error)}`);
  }

  // CSRF check: the state must match what /api/oauth issued to this browser.
  if (!state || !expectedState || state !== expectedState) {
    return redirectToSetup(request, 'error=state_mismatch');
  }

  if (!code) {
    return redirectToSetup(request, 'error=no_code');
  }

  try {
    const tokens = await exchangeCode(code);
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
    saveToken('google', tokens.access_token, tokens.refresh_token, expiresAt);

    return redirectToSetup(request, 'success=1');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    console.error('[oauth] Callback error:', message);
    return redirectToSetup(request, `error=${encodeURIComponent(message)}`);
  }
}
