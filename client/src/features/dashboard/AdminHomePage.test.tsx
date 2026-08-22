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

  it('links to the academy settings, academics settings, and profile pages', async () => {
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

    await waitFor(() => expect(screen.getByRole('link', { name: '학원 기본정보' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: '학원 기본정보' })).toHaveAttribute('href', '/admin/settings/academy');
    expect(screen.getByRole('link', { name: '학교·학년 기준정보' })).toHaveAttribute(
      'href',
      '/admin/settings/academics'
    );
    expect(screen.getByRole('link', { name: '보호자 관리' })).toHaveAttribute('href', '/admin/guardians');
    expect(screen.getByRole('link', { name: '학생 관리' })).toHaveAttribute('href', '/admin/students');
    expect(screen.getByRole('link', { name: '등원 조회' })).toHaveAttribute('href', '/admin/check-ins');
    expect(screen.getByRole('link', { name: '강사 관리' })).toHaveAttribute('href', '/admin/instructors');
    expect(screen.getByRole('link', { name: '강좌 관리' })).toHaveAttribute('href', '/admin/courses');
    expect(screen.getByRole('link', { name: '문자 발송 설정' })).toHaveAttribute('href', '/admin/messaging/settings');
    expect(screen.getByRole('link', { name: '문자 템플릿' })).toHaveAttribute('href', '/admin/messaging/templates');
    expect(screen.getByRole('link', { name: '문자 발송' })).toHaveAttribute('href', '/admin/messaging/drafts');
    expect(screen.getByRole('link', { name: '카드뉴스' })).toHaveAttribute('href', '/admin/card-news');
    expect(screen.getByRole('link', { name: '카드뉴스 플랫폼 프리셋' })).toHaveAttribute('href', '/admin/card-news/presets');
    expect(screen.getByRole('link', { name: '내 계정' })).toHaveAttribute('href', '/admin/profile');
  });
});
