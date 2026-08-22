import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageCampaignsPage } from './MessageCampaignsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('MessageCampaignsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists campaigns and dispatches a queued one', async () => {
    const campaigns = [
      { id: 'c1', name: '등원 안내', status: 'queued', sendMode: 'immediate', scheduledAt: null, totalContacts: 3, totalSendItems: 3, failedCount: 0, updatedAt: '' },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/message-campaigns' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(campaigns));
      if (path === '/api/message-campaigns/c1/dispatch' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ...campaigns[0], status: 'completed' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MessageCampaignsPage />);
    await screen.findByText('등원 안내');

    fireEvent.click(screen.getByRole('button', { name: '지금 발송' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/message-campaigns/c1/dispatch', expect.objectContaining({ method: 'POST' })));
  });
});
