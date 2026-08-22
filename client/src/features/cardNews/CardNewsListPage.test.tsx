import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardNewsListPage } from './CardNewsListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('CardNewsListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads projects and presets, and creates a new project', async () => {
    const projects = [{ id: 'proj1', name: '여름 특강 홍보', status: 'draft', expiresAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-22T00:00:00Z' }];
    const presets = [{ id: 'preset1', name: '인스타 정사각형' }];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/card-news' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(projects));
      if (path === '/api/platform-presets' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(presets));
      if (path === '/api/card-news' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'proj2', name: '신규 프로젝트', status: 'draft', expiresAt: '', updatedAt: '' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardNewsListPage />);
    await screen.findByText('여름 특강 홍보');

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '신규 프로젝트' } });
    fireEvent.change(screen.getByLabelText('플랫폼 프리셋'), { target: { value: 'preset1' } });
    fireEvent.click(screen.getByRole('button', { name: '만들기' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/card-news',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '신규 프로젝트', presetId: 'preset1' }) })
      )
    );
    await screen.findByText('신규 프로젝트');
  });
});
