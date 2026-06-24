import { getToken, saveToken } from '@/lib/db/tokens';
import { fetchWithTimeout } from '@/lib/http';
import { isCalendarWriteEnabled } from '@/lib/config';

const PROVIDER = 'google';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
// Scope is chosen by config.google.calendarAccess. Read-only deployments (the
// default) request only calendar.readonly and never ask Google for write access
// they won't use. Read-write deployments request calendar.events (read + event
// create/update/delete, but not the broader calendar-list/settings management the
// plain `…/auth/calendar` scope carries).
const SCOPE_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPE_READWRITE = 'https://www.googleapis.com/auth/calendar.events';

function getScope(): string {
  return isCalendarWriteEnabled() ? SCOPE_READWRITE : SCOPE_READONLY;
}

/** Cookie carrying the OAuth CSRF state between /api/oauth and the callback. */
export const OAUTH_STATE_COOKIE = 'homehq_oauth_state';

function getCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!clientId || !clientSecret || !baseUrl) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or NEXT_PUBLIC_BASE_URL');
  }
  return { clientId, clientSecret, redirectUri: `${baseUrl}/api/oauth/callback` };
}

export function getAuthUrl(state: string): string {
  const { clientId, redirectUri } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: getScope(),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const { clientId, clientSecret, redirectUri } = getCredentials();
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const { clientId, clientSecret } = getCredentials();
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function getValidAccessToken(): Promise<string> {
  const token = getToken(PROVIDER);
  if (!token?.refresh_token) {
    throw new Error('No Google OAuth token found — connect via /setup');
  }

  // If access token exists and not expired (with 60s buffer), use it
  if (token.access_token && token.expires_at && token.expires_at > Date.now() / 1000 + 60) {
    return token.access_token;
  }

  // Refresh the token
  try {
    const refreshed = await refreshAccessToken(token.refresh_token);
    const expiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
    saveToken(PROVIDER, refreshed.access_token, null, expiresAt);
    return refreshed.access_token;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // invalid_grant means the refresh token is dead (revoked, expired, or
    // garbage) — refreshing will never succeed again without re-consent.
    if (message.includes('invalid_grant')) {
      throw new Error('Google authorization revoked — reconnect at /setup');
    }
    throw err;
  }
}
