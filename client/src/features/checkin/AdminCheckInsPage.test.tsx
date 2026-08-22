import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCheckInsPage } from './AdminCheckInsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-16T00:00:00+09:00' } }),
  };
}

describe('AdminCheckInsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the list and cancels a check-in', async () => {
    const rows = [
      { id: 'c1', studentId: 's1', checkInDate: '2026-08-16', checkInAt: '2026-08-16T00:00:00.000Z', source: 'kiosk', status: 'active', exceptionReason: null, updatedAt: '2026-08-16T00:00:00.000Z' },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/check-ins' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(rows));
      if (path === '/api/check-ins/c1/cancel' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ...rows[0], status: 'canceled' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('prompt', () => '취소 사유');

    render(<AdminCheckInsPage />);

    await screen.findByText('active');
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/check-ins/c1/cancel', expect.objectContaining({ method: 'POST' })));
  });

  it('submits a manual check-in with the exception checkbox checked as allowException: true', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/check-ins' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse([]));
      if (path === '/api/students?search=%EA%B9%80' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse([{ id: 's9', name: '김*수', phoneNormalized: '010-****-1234' }]));
      }
      if (path === '/api/check-ins/manual' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            id: 'c2',
            studentId: 's9',
            checkInDate: '2026-08-16',
            checkInAt: '2026-08-16T00:00:00.000Z',
            source: 'admin',
            status: 'active',
            exceptionReason: '오후 보강 재등원',
            updatedAt: '2026-08-16T00:00:00.000Z',
          })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminCheckInsPage />);

    fireEvent.change(screen.getByLabelText('학생 검색'), { target: { value: '김' } });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    fireEvent.click(await screen.findByRole('button', { name: /김\*수/ }));

    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '오후 보강 재등원' } });
    fireEvent.click(screen.getByLabelText('예외 등원 허용 (이미 등원 기록이 있어도 추가 등록)'));
    fireEvent.click(screen.getByRole('button', { name: '수동 등원 등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/check-ins/manual',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ studentId: 's9', reason: '오후 보강 재등원', allowException: true }),
        })
      )
    );
  });
});
