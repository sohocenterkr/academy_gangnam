import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageDraftsListPage } from './MessageDraftsListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('MessageDraftsListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads drafts and creates a new one', async () => {
    const drafts = [{ id: 'd1', name: '등원 안내 발송', status: 'draft', messageType: 'informational', updatedAt: '2026-08-22T00:00:00Z' }];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/message-drafts' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(drafts));
      if (path === '/api/message-drafts' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'd2', name: '신규 발송', status: 'draft', messageType: 'informational', updatedAt: '' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MessageDraftsListPage />);
    await screen.findByText('등원 안내 발송');

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '신규 발송' } });
    fireEvent.click(screen.getByRole('button', { name: '만들기' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/message-drafts',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '신규 발송', messageType: 'informational' }) })
      )
    );
    await screen.findByText('신규 발송');
  });
});
