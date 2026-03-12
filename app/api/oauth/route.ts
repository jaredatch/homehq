import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google/oauth';

export function GET() {
  try {
    const url = getAuthUrl();
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build auth URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
