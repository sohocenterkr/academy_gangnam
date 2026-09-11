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

  it('links to the public check-in kiosk screen, opened in a new tab', async () => {
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

    const link = await screen.findByRole('link', { name: '등원 체크인 화면 열기' });
    expect(link).toHaveAttribute('href', '/check-in');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the dashboard summary stats once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            activeStudentCount: 12,
            activeEnrollmentCount: 15,
            todayCheckInCount: 3,
            pendingMessageCampaignCount: 1,
            todayMessageSendItemCount: 4,
            dailyMessageLimit: 500,
            activeCardNewsProjectCount: 2,
          },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    render(<AdminHomePage />);

    await waitFor(() => expect(screen.getByText('12명')).toBeInTheDocument());
    expect(screen.getByText('3명')).toBeInTheDocument();
    expect(screen.getByText('4 / 500건')).toBeInTheDocument();
  });
});
