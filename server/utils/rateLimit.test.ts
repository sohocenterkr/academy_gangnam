import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows requests up to the limit within the window', () => {
    const isAllowed = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(isAllowed('key-a', 0)).toBe(true);
    expect(isAllowed('key-a', 10)).toBe(true);
    expect(isAllowed('key-a', 20)).toBe(true);
    expect(isAllowed('key-a', 30)).toBe(false);
  });

  it('tracks separate keys independently', () => {
    const isAllowed = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(isAllowed('key-a', 0)).toBe(true);
    expect(isAllowed('key-b', 0)).toBe(true);
  });

  it('allows requests again once old ones fall outside the window', () => {
    const isAllowed = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(isAllowed('key-a', 0)).toBe(true);
    expect(isAllowed('key-a', 500)).toBe(false);
    expect(isAllowed('key-a', 1500)).toBe(true);
  });
});
