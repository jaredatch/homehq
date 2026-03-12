import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exchangeCode } from '@/lib/google/oauth';
import { saveToken } from '@/lib/db/tokens';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/setup?error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/setup?error=no_code', request.url),
    );
  }

  try {
    const tokens = await exchangeCode(code);
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
    saveToken('google', tokens.access_token, tokens.refresh_token, expiresAt);

    return NextResponse.redirect(new URL('/setup?success=1', request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    console.error('[oauth] Callback error:', message);
    return NextResponse.redirect(
      new URL(`/setup?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
