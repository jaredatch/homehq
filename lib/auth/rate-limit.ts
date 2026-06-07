/**
 * In-memory failure-based rate limiter for the PIN endpoint.
 *
 * Single-instance app (one Node process on one box), so module-level state is
 * sufficient — no Redis needed. A 6-digit PIN has 10^6 combinations; capping
 * failures at 5 per window makes online brute force impractical.
 */

interface AttemptRecord {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

export interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

const DEFAULT_OPTIONS: RateLimiterOptions = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
};

const MAX_TRACKED_KEYS = 1000;

export class FailureRateLimiter {
  private attempts = new Map<string, AttemptRecord>();
  private options: RateLimiterOptions;

  constructor(options: Partial<RateLimiterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** True if the key is currently locked out. */
  isLocked(key: string, now = Date.now()): boolean {
    const record = this.attempts.get(key);
    if (!record) return false;
    if (record.lockedUntil > now) return true;
    if (now - record.windowStart > this.options.windowMs && record.lockedUntil <= now) {
      this.attempts.delete(key);
      return false;
    }
    return false;
  }

  /** Record a failed attempt. Returns true if the key is now locked. */
  recordFailure(key: string, now = Date.now()): boolean {
    this.prune(now);

    let record = this.attempts.get(key);
    if (!record || now - record.windowStart > this.options.windowMs) {
      record = { failures: 0, windowStart: now, lockedUntil: 0 };
      this.attempts.set(key, record);
    }

    record.failures += 1;
    if (record.failures >= this.options.maxFailures) {
      record.lockedUntil = now + this.options.lockoutMs;
      return true;
    }
    return false;
  }

  /** Clear failures for a key (after a successful attempt). */
  clear(key: string): void {
    this.attempts.delete(key);
  }

  /** Drop expired records so the map can't grow unbounded. */
  private prune(now: number): void {
    if (this.attempts.size < MAX_TRACKED_KEYS) return;
    for (const [key, record] of this.attempts) {
      const windowExpired = now - record.windowStart > this.options.windowMs;
      if (windowExpired && record.lockedUntil <= now) {
        this.attempts.delete(key);
      }
    }
  }
}
