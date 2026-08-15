import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiDelete, apiGet, apiPatch, apiPost, ApiRequestError } from './apiClient';

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

describe('apiPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a JSON body and returns the data payload on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: '1' },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/api/auth/login', { email: 'a@b.com', password: 'x' })).resolves.toEqual({
      id: '1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'x' }) })
    );
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'UNAUTHENTICATED', message: '이메일 또는 비밀번호가 올바르지 않습니다.', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiPost('/api/auth/login', {})).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('apiPatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a JSON body via PATCH and returns the data payload on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: '1', name: 'updated' },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPatch('/api/schools/1', { name: 'updated' })).resolves.toEqual({
      id: '1',
      name: 'updated',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schools/1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'updated' }) })
    );
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다.', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiPatch('/api/schools/1', {})).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('apiDelete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a DELETE request and returns the data payload on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { success: true },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiDelete('/api/schools/1')).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schools/1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'IN_USE', message: '사용 중입니다.', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiDelete('/api/schools/1')).rejects.toBeInstanceOf(ApiRequestError);
  });
});
