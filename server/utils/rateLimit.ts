interface RateLimiterOptions {
  limit: number;
  windowMs: number;
}

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return function isAllowed(key: string, now: number = Date.now()): boolean {
    const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (timestamps.length >= limit) {
      hits.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  };
}
