type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

export class TokenBucketRateLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(capacity: number, refillPerSec: number) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
  }

  consume(key: string, tokens = 1): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefillMs: now,
    };

    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    const refilled = Math.min(
      this.capacity,
      bucket.tokens + elapsedSec * this.refillPerSec
    );

    bucket.tokens = refilled;
    bucket.lastRefillMs = now;

    if (bucket.tokens < tokens) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.tokens -= tokens;
    this.buckets.set(key, bucket);
    return true;
  }

  sweep(maxIdleMs = 3600000) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefillMs > maxIdleMs) {
        this.buckets.delete(key);
      }
    }
  }
}
