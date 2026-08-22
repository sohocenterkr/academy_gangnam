import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditLogsPage } from './AuditLogsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('AuditLogsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads entries and filters by target type', async () => {
    const entries = [
      { id: 'a1', adminId: 'admin1', roleSnapshot: '최고관리자', action: 'student.create', targetType: 'student', targetId: 's1', result: 'success', createdAt: '2026-08-22T00:00:00Z' },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string) => {
      if (path === '/api/audit-logs') return Promise.resolve(jsonResponse(entries));
      if (path === '/api/audit-logs?targetType=student') return Promise.resolve(jsonResponse(entries));
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuditLogsPage />);
    await screen.findByText('student.create');

    fireEvent.change(screen.getByPlaceholderText('대상 유형 (예: student, checkIn)'), { target: { value: 'student' } });
    fireEvent.click(screen.getByRole('button', { name: '필터' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/audit-logs?targetType=student', expect.anything()));
  });
});
