import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevHomePage } from './DevHomePage';

describe('DevHomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a healthy status once the health check succeeds', async () => {
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

    render(<DevHomePage />);

    await waitFor(() =>
      expect(screen.getByTestId('health-status')).toHaveTextContent('서버 연결 정상')
    );
  });

  it('shows an error status when the health check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<DevHomePage />);

    await waitFor(() =>
      expect(screen.getByTestId('health-status')).toHaveTextContent('서버 연결 실패')
    );
  });
});
