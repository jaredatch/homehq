import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { createSession, COOKIE_NAME } from '@/lib/auth/session';

export async function POST(request: Request) {
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
  if (pin !== config.auth.pin) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const token = await createSession(secret);
  const response = NextResponse.json({ success: true });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
