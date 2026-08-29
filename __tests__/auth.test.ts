import { describe, it, expect } from 'vitest';
import {
  createSession,
  verifySession,
  readSession,
  shouldRenewSession,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_AFTER_MS,
  sessionOpensBoard,
} from '@/lib/auth/session';

const TEST_SECRET = 'test-secret-key-for-hmac-signing';

describe('session', () => {
  it('exports the cookie name', () => {
    expect(COOKIE_NAME).toBe('homehq_session');
  });

  it('creates a valid session token', async () => {
    const token = await createSession(TEST_SECRET);
    expect(token).toContain('.');

    const [payload, signature] = token.split('.');
    expect(payload.length).toBeGreaterThan(0);
    expect(signature.length).toBeGreaterThan(0);

    // Payload should be base64-encoded JSON with a created timestamp
    const decoded = JSON.parse(atob(payload));
    expect(decoded).toHaveProperty('created');
    expect(typeof decoded.created).toBe('number');
  });

  it('verifies a valid token', async () => {
    const token = await createSession(TEST_SECRET);
    const valid = await verifySession(token, TEST_SECRET);
    expect(valid).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSession(TEST_SECRET);
    const valid = await verifySession(token, 'wrong-secret');
    expect(valid).toBe(false);
  });

  it('rejects a tampered payload', async () => {
    const token = await createSession(TEST_SECRET);
    const [, signature] = token.split('.');
    const tamperedPayload = btoa(JSON.stringify({ created: 0 }));
    const valid = await verifySession(`${tamperedPayload}.${signature}`, TEST_SECRET);
    expect(valid).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const token = await createSession(TEST_SECRET);
    const [payload] = token.split('.');
    const valid = await verifySession(`${payload}.deadbeef`, TEST_SECRET);
    expect(valid).toBe(false);
  });

  it('rejects empty string', async () => {
    const valid = await verifySession('', TEST_SECRET);
    expect(valid).toBe(false);
  });

  it('rejects token without dot separator', async () => {
    const valid = await verifySession('nodot', TEST_SECRET);
    expect(valid).toBe(false);
  });

  it('produces unique tokens for each call', async () => {
    const token1 = await createSession(TEST_SECRET);
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));
    const token2 = await createSession(TEST_SECRET);
    expect(token1).not.toBe(token2);
  });

  it('rejects a session older than the max age', async () => {
    const old = Date.now() - SESSION_MAX_AGE_MS - 1000;
    const token = await createSession(TEST_SECRET, undefined, old);
    expect(await verifySession(token, TEST_SECRET)).toBe(false);
  });

  it('rejects a future-dated session', async () => {
    const future = Date.now() + 10 * 60 * 1000;
    const token = await createSession(TEST_SECRET, undefined, future);
    expect(await verifySession(token, TEST_SECRET)).toBe(false);
  });

  it('reads the created timestamp from a valid session', async () => {
    const now = Date.now();
    const token = await createSession(TEST_SECRET, undefined, now);
    const session = await readSession(token, TEST_SECRET);
    expect(session).toEqual({ created: now });
  });

  it('flags sessions past the renewal threshold for re-issue', () => {
    const now = Date.now();
    expect(shouldRenewSession({ created: now }, now)).toBe(false);
    expect(shouldRenewSession({ created: now - SESSION_RENEW_AFTER_MS - 1000 }, now)).toBe(true);
  });
});

describe('board-scoped sessions', () => {
  const TEST_SECRET = 'test-secret-at-least-32-characters-long!';

  it('round-trips the board a session was created for', async () => {
    const token = await createSession(TEST_SECRET, 'kida');
    expect(await readSession(token, TEST_SECRET)).toMatchObject({ board: 'kida' });
  });

  it('leaves a family session unstamped', async () => {
    // Byte-identical to what this issued before per-board PINs existed, which
    // is what stops a deploy logging the kitchen wall out.
    const now = Date.now();
    const token = await createSession(TEST_SECRET, undefined, now);
    expect(await readSession(token, TEST_SECRET)).toEqual({ created: now });
  });

  it('lets an unstamped session open every board', async () => {
    // The household PIN is deliberately a master key: a parent is never locked
    // out of a panel, and a path-only install keeps working with one PIN.
    const session = { created: Date.now() };
    expect(sessionOpensBoard(session, 'kida')).toBe(true);
    expect(sessionOpensBoard(session, 'family')).toBe(true);
  });

  it('confines a stamped session to its own board', async () => {
    const session = { created: Date.now(), board: 'kida' };
    expect(sessionOpensBoard(session, 'kida')).toBe(true);
    expect(sessionOpensBoard(session, 'kidb')).toBe(false);
    // Including the family board — a kid's PIN must not open the kitchen wall.
    expect(sessionOpensBoard(session, 'family')).toBe(false);
  });

  it('refuses a board stamp that was tampered with', async () => {
    // The stamp is inside the signed payload, so widening it invalidates the
    // whole token rather than granting anything.
    const token = await createSession(TEST_SECRET, 'kida');
    const [payload, sig] = token.split('.');
    const forged = `${btoa(JSON.stringify({ ...JSON.parse(atob(payload)), board: 'family' }))}.${sig}`;
    expect(await readSession(forged, TEST_SECRET)).toBeNull();
  });
});
