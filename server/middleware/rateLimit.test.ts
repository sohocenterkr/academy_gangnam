import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimitMiddleware } from './rateLimit';

function buildApp() {
  const app = express();
  app.use(createRateLimitMiddleware({ windowMs: 1000, max: 2 }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimitMiddleware', () => {
  it('allows requests up to the limit, then rejects with 429', async () => {
    const app = buildApp();

    const first = await request(app).get('/ping');
    const second = await request(app).get('/ping');
    const third = await request(app).get('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('resets after the window elapses', async () => {
    const app = express();
    app.use(createRateLimitMiddleware({ windowMs: 50, max: 1 }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const first = await request(app).get('/ping');
    expect(first.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 80));

    const second = await request(app).get('/ping');
    expect(second.status).toBe(200);
  });
});
