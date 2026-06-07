const COOKIE_NAME = 'homehq_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_RENEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const encoder = new TextEncoder();

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

export interface SessionInfo {
  created: number;
}

export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const payload = btoa(JSON.stringify({ created: now }));
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${bufferToHex(signature)}`;
}

/**
 * Verify a session token's signature and age. Returns the session payload,
 * or null if the token is invalid or older than SESSION_MAX_AGE_MS.
 */
export async function readSession(
  token: string,
  secret: string,
  now = Date.now()
): Promise<SessionInfo | null> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;

  const payload = token.substring(0, dotIndex);
  const sig = token.substring(dotIndex + 1);

  if (!payload || !sig || sig.length % 2 !== 0) return null;

  try {
    const key = await getKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      hexToBuffer(sig),
      encoder.encode(payload)
    );
    if (!valid) return null;

    const data = JSON.parse(atob(payload)) as Partial<SessionInfo>;
    if (typeof data.created !== 'number') return null;
    if (now - data.created > SESSION_MAX_AGE_MS) return null;
    if (data.created > now + 60_000) return null; // future-dated tokens are bogus

    return { created: data.created };
  } catch {
    return null;
  }
}

export async function verifySession(token: string, secret: string): Promise<boolean> {
  return (await readSession(token, secret)) !== null;
}

/**
 * Sliding renewal: tokens older than SESSION_RENEW_AFTER_MS should be
 * re-issued so an always-on kiosk display never hits the 30-day expiry.
 */
export function shouldRenewSession(session: SessionInfo, now = Date.now()): boolean {
  return now - session.created > SESSION_RENEW_AFTER_MS;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  };
}

export { COOKIE_NAME, SESSION_MAX_AGE_MS, SESSION_RENEW_AFTER_MS };
