import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformPresetsPage } from './PlatformPresetsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('PlatformPresetsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads presets and creates a new one', async () => {
    const presets = [{ id: 'p1', platform: 'instagram', postType: 'feed', name: '인스타 정사각형', widthPx: 1080, heightPx: 1080, isActive: true }];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/platform-presets' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(presets));
      if (path === '/api/platform-presets' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'p2', platform: 'instagram', postType: 'story', name: '스토리', widthPx: 1080, heightPx: 1920, isActive: true }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PlatformPresetsPage />);
    await screen.findByText('인스타 정사각형');

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '스토리' } });
    fireEvent.change(screen.getByLabelText('게시 유형'), { target: { value: 'story' } });
    fireEvent.change(screen.getByLabelText('세로(px)'), { target: { value: '1920' } });
    fireEvent.click(screen.getByRole('button', { name: '프리셋 등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/platform-presets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ platform: 'instagram', postType: 'story', name: '스토리', widthPx: 1080, heightPx: 1920 }),
        })
      )
    );
  });
});
