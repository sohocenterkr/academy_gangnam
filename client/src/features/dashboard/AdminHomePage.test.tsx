import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminHomePage } from './AdminHomePage';

describe('AdminHomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('greets the logged-in admin by name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: '1', email: 'a@b.com', name: '홍길동', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    render(<AdminHomePage />);

    await waitFor(() => expect(screen.getByText(/홍길동/)).toBeInTheDocument());
  });
});
