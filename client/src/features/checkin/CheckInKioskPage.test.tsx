import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckInKioskPage } from './CheckInKioskPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-16T00:00:00+09:00' } }),
  };
}

describe('CheckInKioskPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches by last 4 digits, shows one candidate, and confirms check-in', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/check-in/search') {
        return Promise.resolve(
          jsonResponse({ status: 'candidates', candidates: [{ selectionToken: 'tok-1', maskedName: '김*수' }] })
        );
      }
      if (path === '/api/check-in/confirm') {
        return Promise.resolve(jsonResponse({ status: 'confirmed', checkInAt: '2026-08-16T00:00:00.000Z', maskedName: '김*수' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CheckInKioskPage />);

    fireEvent.change(screen.getByLabelText('전화번호 뒤 4자리'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: '등원' }));

    await screen.findByText('김*수');
    fireEvent.click(screen.getByRole('button', { name: '김*수' }));

    await waitFor(() => expect(screen.getByText(/등원.*완료|환영/)).toBeInTheDocument());
  });

  it('shows a no-match message when nothing is found', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ status: 'no_match' })));
    vi.stubGlobal('fetch', fetchMock);

    render(<CheckInKioskPage />);
    fireEvent.change(screen.getByLabelText('전화번호 뒤 4자리'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: '등원' }));

    await screen.findByText(/등록된 학생을 찾을 수 없습니다/);
  });
});
