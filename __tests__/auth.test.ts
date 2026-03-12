import { describe, it, expect } from 'vitest';
import { createSession, verifySession, COOKIE_NAME } from '@/lib/auth/session';

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
});
