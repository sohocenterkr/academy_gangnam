import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcademySettingsPage } from './AcademySettingsPage';

describe('AcademySettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and displays the current academy settings, then saves an edit', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 's1',
          academyName: '기존학원',
          phoneNormalized: '',
          address: '',
          senderName: '',
          updatedAt: '2026-08-15T00:00:00+09:00',
        },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:00:00+09:00' },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 's1',
          academyName: '새이름학원',
          phoneNormalized: '',
          address: '',
          senderName: '',
          updatedAt: '2026-08-15T00:10:00+09:00',
        },
        meta: { requestId: 'req-2', kstTimestamp: '2026-08-15T00:10:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AcademySettingsPage />);

    const nameInput = await screen.findByLabelText('학원 이름');
    expect(nameInput).toHaveValue('기존학원');

    fireEvent.change(nameInput, { target: { value: '새이름학원' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText('저장되었습니다.')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/settings/academy');
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PATCH' });
  });
});
