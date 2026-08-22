import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminsPage } from './AdminsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('AdminsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads admins and roles, and creates a new admin', async () => {
    const admins = [{ id: 'a1', email: 'a@b.com', name: '홍길동', roleId: 'r1', status: 'active', updatedAt: '2026-08-22T00:00:00Z' }];
    const roles = [{ id: 'r1', name: '최고관리자' }, { id: 'r2', name: '강사' }];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/admins' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(admins));
      if (path === '/api/roles' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(roles));
      if (path === '/api/admins' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'a2', email: 'new@b.com', name: '신규', roleId: 'r2', status: 'active', updatedAt: '' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminsPage />);
    await screen.findByText('홍길동');

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'new@b.com' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '신규' } });
    fireEvent.change(screen.getByLabelText('초기 비밀번호'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('역할'), { target: { value: 'r2' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admins',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'new@b.com', name: '신규', password: 'password123', roleId: 'r2' }) })
      )
    );
  });
});
