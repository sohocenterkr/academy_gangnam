import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

describe('GET /api/health', () => {
  it('returns an ok status inside the standard success envelope', async () => {
    const app = createApp();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.meta.requestId).toEqual(expect.any(String));
    expect(response.body.meta.kstTimestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
    );
  });
});
