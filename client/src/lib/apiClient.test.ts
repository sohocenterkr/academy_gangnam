import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, ApiRequestError } from './apiClient';

describe('apiGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the data payload on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { status: 'ok' },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    await expect(apiGet('/api/health')).resolves.toEqual({ status: 'ok' });
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'NOT_FOUND', message: '찾을 수 없습니다', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiGet('/api/missing')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(apiGet('/api/missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '찾을 수 없습니다',
      requestId: 'req-2',
    });
  });

  it('throws ApiRequestError when the response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      })
    );

    await expect(apiGet('/api/health')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('throws ApiRequestError when a non-2xx body is missing the error key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );

    await expect(apiGet('/api/missing')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('throws ApiRequestError when a 2xx body is missing the data key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          meta: { requestId: 'req-3', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    await expect(apiGet('/api/health')).rejects.toBeInstanceOf(ApiRequestError);
  });
});
