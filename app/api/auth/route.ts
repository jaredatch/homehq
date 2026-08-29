import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { boardPin, boardSlugForHost } from '@/lib/config/boards';
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

  let body: { pin?: string; board?: string };
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

  // Which board is being logged into. The hostname decides it on a subdomain
  // install; `board` in the body covers a path-only install, where every board
  // shares one host and `/login?board=<slug>` is the only thing that can say
  // which panel is asking. Both are checked against config — an unknown slug
  // simply resolves to no board, so it can never widen what a PIN opens.
  const host = request.headers.get('host') ?? request.headers.get('x-forwarded-host');
  const requested = typeof body.board === 'string' ? body.board : null;
  const slug = requested && config.boards?.[requested] ? requested : boardSlugForHost(host, config);
  const scopedPin = slug ? boardPin(slug, config) : null;

  // Both comparisons ALWAYS run: short-circuiting on the first match would make
  // the response time say which PIN was tried.
  const boardMatched = scopedPin !== null && pinsMatch(pin, scopedPin);
  const familyMatched = pinsMatch(pin, config.auth.pin);

  if (!boardMatched && !familyMatched) {
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

  // The family PIN wins when both match, because the broader session is the one
  // that can't lock a parent out of the panel they just unlocked.
  const token = await createSession(secret, familyMatched ? undefined : (slug ?? undefined));
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, sessionCookieOptions());
  return response;
}
