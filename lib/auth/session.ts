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
  /**
   * The board this session was created for, when it was created by a board's
   * OWN pin. Absent means the family PIN was used — see `sessionOpensBoard`.
   *
   * Absent is also what every session issued before per-board PINs existed
   * looks like, which is why absence has to mean "opens everything": stamping
   * family sessions instead would have logged the kitchen wall out on deploy.
   */
  board?: string;
}

/**
 * Mint a session. `board` stamps it as belonging to one board; omit it for a
 * family session, which keeps the payload byte-identical to what this issued
 * before boards existed.
 */
export async function createSession(
  secret: string,
  board?: string,
  now = Date.now()
): Promise<string> {
  const payload = btoa(JSON.stringify(board ? { created: now, board } : { created: now }));
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

    return typeof data.board === 'string' && data.board
      ? { created: data.created, board: data.board }
      : { created: data.created };
  } catch {
    return null;
  }
}

export async function verifySession(token: string, secret: string): Promise<boolean> {
  return (await readSession(token, secret)) !== null;
}

/**
 * Whether a session may open a given board.
 *
 * An UNSTAMPED session came from the family PIN and opens every board — the
 * household code is deliberately a master key, so a parent is never locked out
 * of a kid's panel and a path-only install (`/b/<slug>` with no subdomains)
 * keeps working with one PIN exactly as it did before.
 *
 * A STAMPED session came from one board's own PIN and opens only that board.
 * That is the whole point: the code a kid types on her panel is not the code
 * that opens the kitchen wall.
 *
 * Pure, and free of config and filesystem access on purpose — the proxy runs
 * on the Edge runtime and has to be able to call this.
 */
export function sessionOpensBoard(session: SessionInfo, slug: string): boolean {
  return !session.board || session.board === slug;
}

/**
 * The dev-only auth bypass, in one place so the proxy and the server pages
 * can't drift apart on it. Doubly guarded: a non-production build AND an
 * explicit opt-in, so it can never weaken the gate in production even if the
 * flag leaks into a prod environment.
 */
export function isAuthBypassed(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS === '1';
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
