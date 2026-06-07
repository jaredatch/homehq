import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { createSession, sessionCookieOptions, COOKIE_NAME } from '@/lib/auth/session';
import { FailureRateLimiter } from '@/lib/auth/rate-limit';

const limiter = new FailureRateLimiter();

function clientKey(request: Request): string {
  // Use X-Real-IP, which our nginx config sets to $remote_addr (the true TCP
  // peer). We must NOT trust X-Forwarded-For here: a client can send its own
  // XFF header and nginx appends to it, so the *client-supplied* value would
  // be first — letting an attacker rotate the limiter key and brute-force the
  // PIN. See docs/deployment.md for the matching nginx directives.
  const realIp = request.headers.get('x-real-ip');
  return realIp?.trim() || 'direct';
}

function pinsMatch(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  // Length is public knowledge (PINs are 6 digits), so this doesn't leak.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const key = clientKey(request);

  if (limiter.isLocked(key)) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Try again in a few minutes.' },
      { status: 429 }
    );
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { pin } = body;
  if (!pin || typeof pin !== 'string') {
    return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
  }

  const config = getConfig();
  if (!pinsMatch(pin, config.auth.pin)) {
    const locked = limiter.recordFailure(key);
    return NextResponse.json(
      {
        error: locked ? 'Too many failed attempts. Try again in a few minutes.' : 'Invalid PIN',
      },
      { status: locked ? 429 : 401 }
    );
  }

  limiter.clear(key);

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const token = await createSession(secret);
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, sessionCookieOptions());
  return response;
}
