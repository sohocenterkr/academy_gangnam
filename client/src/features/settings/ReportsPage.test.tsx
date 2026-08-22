import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportsPage } from './ReportsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('ReportsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a report and generates an export', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/reports/check-ins') return Promise.resolve(jsonResponse({ bySource: [], byDate: [] }));
      if (path === '/api/exports' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'e1', status: 'completed', downloadUrl: 'https://example.com/export.xlsx' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ReportsPage />);

    fireEvent.click(screen.getByRole('button', { name: '조회' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/reports/check-ins', expect.anything()));

    fireEvent.click(screen.getByRole('button', { name: '엑셀로 내보내기' }));
    await screen.findByRole('link', { name: '다운로드' });
    expect(screen.getByRole('link', { name: '다운로드' })).toHaveAttribute('href', 'https://example.com/export.xlsx');
  });
});
