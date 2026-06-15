import { NextResponse } from 'next/server';
import { getDeployVersion } from '@/lib/version';

// Read the token fresh on every request — a manual bump (kiosk-reload.sh) must be
// seen without restarting the app.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ version: getDeployVersion() });
}
