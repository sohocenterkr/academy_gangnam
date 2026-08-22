import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CardNewsDetailPage } from './CardNewsDetailPage';

vi.mock('../../lib/upload', () => ({
  uploadFileDirect: vi.fn().mockResolvedValue({ id: 'media-new', secureUrl: 'https://example.com/new.jpg', resourceType: 'image', bytes: 100 }),
}));

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

function renderAtProject(projectId: string) {
  const { hook } = memoryLocation({ path: `/admin/card-news/${projectId}`, static: true });
  return render(
    <Router hook={hook}>
      <Route path="/admin/card-news/:projectId">
        <CardNewsDetailPage />
      </Route>
    </Router>
  );
}

const baseProject = {
  id: 'proj1',
  name: '여름 특강 홍보',
  title: null,
  story: null,
  status: 'draft',
  sendPhotosToAi: false,
  privacyConfirmedAt: null,
  expiresAt: '2026-08-29',
  updatedAt: '2026-08-22T00:00:00.000Z',
  media: [],
};

describe('CardNewsDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the project and saves title/story edits', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/card-news/proj1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseProject));
      if (path === '/api/card-news/proj1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...baseProject, title: '여름 방학 특강', updatedAt: '2026-08-22T00:01:00.000Z' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtProject('proj1');
    await screen.findByText('여름 특강 홍보');

    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '여름 방학 특강' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/card-news/proj1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: '여름 방학 특강', story: '', expectedUpdatedAt: baseProject.updatedAt }),
        })
      )
    );
  });

  it('requires a confirm before turning AI photo sending on', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/card-news/proj1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseProject));
      if (path === '/api/card-news/proj1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...baseProject, sendPhotosToAi: true, privacyConfirmedAt: '2026-08-22T00:01:00.000Z' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    renderAtProject('proj1');
    await screen.findByText('여름 특강 홍보');

    fireEvent.click(screen.getByLabelText('사진을 AI 공급자에게 전달해 문구·구성을 생성합니다'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/card-news/proj1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ sendPhotosToAi: true, privacyConfirmed: true, expectedUpdatedAt: baseProject.updatedAt }),
        })
      )
    );
  });
});
