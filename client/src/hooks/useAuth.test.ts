import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './useAuth';

describe('useAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the current admin from /api/auth/me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: '1', email: 'a@b.com', name: '관리자', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    const { result } = renderHook(() => useAuth());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.admin?.email).toBe('a@b.com');
    expect(result.current.error).toBeNull();
  });

  it('sets error and null admin when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: 'req-2' } }),
      })
    );

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.admin).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
});
