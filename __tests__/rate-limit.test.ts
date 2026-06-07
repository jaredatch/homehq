import { describe, it, expect } from 'vitest';
import { FailureRateLimiter } from '@/lib/auth/rate-limit';

const OPTS = { maxFailures: 3, windowMs: 60_000, lockoutMs: 120_000 };

describe('FailureRateLimiter', () => {
  it('is unlocked with no failures', () => {
    const limiter = new FailureRateLimiter(OPTS);
    expect(limiter.isLocked('ip', 0)).toBe(false);
  });

  it('locks after max failures within the window', () => {
    const limiter = new FailureRateLimiter(OPTS);
    expect(limiter.recordFailure('ip', 0)).toBe(false);
    expect(limiter.recordFailure('ip', 1000)).toBe(false);
    expect(limiter.recordFailure('ip', 2000)).toBe(true);
    expect(limiter.isLocked('ip', 3000)).toBe(true);
  });

  it('unlocks after the lockout expires', () => {
    const limiter = new FailureRateLimiter(OPTS);
    limiter.recordFailure('ip', 0);
    limiter.recordFailure('ip', 0);
    limiter.recordFailure('ip', 0);
    expect(limiter.isLocked('ip', OPTS.lockoutMs - 1)).toBe(true);
    expect(limiter.isLocked('ip', OPTS.lockoutMs + 1)).toBe(false);
  });

  it('resets the failure count when the window expires', () => {
    const limiter = new FailureRateLimiter(OPTS);
    limiter.recordFailure('ip', 0);
    limiter.recordFailure('ip', 0);
    // Window expires; next failure starts a fresh count.
    expect(limiter.recordFailure('ip', OPTS.windowMs + 1000)).toBe(false);
    expect(limiter.isLocked('ip', OPTS.windowMs + 2000)).toBe(false);
  });

  it('clears failures on success', () => {
    const limiter = new FailureRateLimiter(OPTS);
    limiter.recordFailure('ip', 0);
    limiter.recordFailure('ip', 0);
    limiter.clear('ip');
    expect(limiter.recordFailure('ip', 0)).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new FailureRateLimiter(OPTS);
    limiter.recordFailure('a', 0);
    limiter.recordFailure('a', 0);
    limiter.recordFailure('a', 0);
    expect(limiter.isLocked('a', 0)).toBe(true);
    expect(limiter.isLocked('b', 0)).toBe(false);
  });
});
