import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { AdminLayout } from './AdminLayout';
import type { AuthenticatedAdmin } from '../../hooks/useAuth';

const admin: AuthenticatedAdmin = {
  id: '1',
  email: 'a@b.com',
  name: '홍길동',
  role: { id: 'r1', name: '최고관리자', permissions: ['*'] },
};

function renderLayout() {
  return render(
    <Router>
      <AdminLayout admin={admin}>
        <p>페이지 내용</p>
      </AdminLayout>
    </Router>
  );
}

describe('AdminLayout', () => {
  it('renders children content', () => {
    renderLayout();
    expect(screen.getByText('페이지 내용')).toBeInTheDocument();
  });

  it('shows the admin name and role in the header', () => {
    renderLayout();
    expect(screen.getByText('홍길동')).toBeInTheDocument();
    expect(screen.getByText('(최고관리자)')).toBeInTheDocument();
  });

  it('links to every admin section', () => {
    renderLayout();
    const expectedLinks: Array<[string, string]> = [
      ['학원 기본정보', '/admin/settings/academy'],
      ['학교·학년 기준정보', '/admin/settings/academics'],
      ['보호자 관리', '/admin/guardians'],
      ['학생 관리', '/admin/students'],
      ['등원 조회', '/admin/check-ins'],
      ['강사 관리', '/admin/instructors'],
      ['강좌 관리', '/admin/courses'],
      ['문자 발송 설정', '/admin/messaging/settings'],
      ['문자 템플릿', '/admin/messaging/templates'],
      ['문자 발송', '/admin/messaging/drafts'],
      ['문자 발송 현황', '/admin/messaging/campaigns'],
      ['카드뉴스', '/admin/card-news'],
      ['카드뉴스 플랫폼 프리셋', '/admin/card-news/presets'],
      ['관리자 계정', '/admin/settings/admins'],
      ['역할·권한 관리', '/admin/settings/roles'],
      ['보고서', '/admin/reports'],
      ['감사 로그', '/admin/audit-logs'],
    ];

    for (const [label, href] of expectedLinks) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('logs out and redirects to /login when the logout button is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {}, meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLayout();
    screen.getByRole('button', { name: '로그아웃' }).click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.anything()));
    vi.unstubAllGlobals();
  });
});
