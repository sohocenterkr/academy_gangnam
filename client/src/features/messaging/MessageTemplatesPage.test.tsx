import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageTemplatesPage } from './MessageTemplatesPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('MessageTemplatesPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads templates and creates a new one', async () => {
    const templates = [
      { id: 't1', name: '등원 안내', category: null, messageType: 'informational', body: '{{이름}} 학생 등원했습니다.', description: null, status: 'active', usageCount: 0 },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/message-templates' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(templates));
      if (path === '/api/message-templates' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 't2', name: '신규 템플릿', messageType: 'informational', body: '내용', status: 'active', usageCount: 0 }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MessageTemplatesPage />);

    await screen.findByText('등원 안내');

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '신규 템플릿' } });
    fireEvent.change(screen.getByLabelText(/본문/), { target: { value: '내용' } });
    fireEvent.click(screen.getByRole('button', { name: '템플릿 등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/message-templates',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '신규 템플릿', messageType: 'informational', body: '내용' }) })
      )
    );
  });

  it('copies a template', async () => {
    const templates = [
      { id: 't1', name: '등원 안내', category: null, messageType: 'informational', body: '내용', description: null, status: 'active', usageCount: 0 },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/message-templates' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(templates));
      if (path === '/api/message-templates/t1/copy' && init?.method === 'POST') return Promise.resolve(jsonResponse({ ...templates[0], id: 't2', name: '등원 안내 사본' }));
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MessageTemplatesPage />);
    await screen.findByText('등원 안내');
    fireEvent.click(screen.getByRole('button', { name: '복사' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/message-templates/t1/copy', expect.objectContaining({ method: 'POST' })));
  });
});
