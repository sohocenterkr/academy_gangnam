import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

/**
 * A simple in-memory sliding-window rate limiter, keyed by `req.ip`. This is correct for a
 * single Node process (this project's local dev server) but NOT correct across multiple
 * serverless function instances — revisit with a DB- or Redis-backed limiter before/when this
 * app is deployed to Vercel's multi-instance production environment (see CLAUDE.md).
 */
export function createRateLimitMiddleware(options: RateLimiterOptions): RequestHandler {
  const buckets = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < options.windowMs);

    if (recent.length >= options.max) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}
