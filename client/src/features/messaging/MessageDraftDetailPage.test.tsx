import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { MessageDraftDetailPage } from './MessageDraftDetailPage';

vi.mock('../../lib/upload', () => ({
  uploadFileDirect: vi.fn(),
}));

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

function renderAtDraft(draftId: string) {
  const { hook } = memoryLocation({ path: `/admin/messaging/drafts/${draftId}`, static: true });
  return render(
    <Router hook={hook}>
      <Route path="/admin/messaging/drafts/:draftId">
        <MessageDraftDetailPage />
      </Route>
    </Router>
  );
}

const baseDraft = {
  id: 'd1',
  name: '등원 안내 발송',
  status: 'draft',
  recipientType: 'all',
  filterSnapshot: {},
  duplicateStrategy: 'merge',
  bodySource: '',
  updatedAt: '2026-08-22T00:00:00.000Z',
  media: [],
};

describe('MessageDraftDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the draft, previews recipients, and approves it', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/message-drafts/d1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseDraft));
      if (path === '/api/grade-levels') return Promise.resolve(jsonResponse([]));
      if (path === '/api/courses') return Promise.resolve(jsonResponse([]));
      if (path === '/api/message-templates') return Promise.resolve(jsonResponse([]));
      if (path === '/api/messaging/devices') return Promise.resolve(jsonResponse([{ id: 'dev1', nickname: '기기', isEnabled: true }]));
      if (path === '/api/message-drafts/d1/recipient-preview' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ totalCandidates: 2, includedCount: 2, excludedCount: 0, optOutCount: 0, sample: [] }));
      }
      if (path === '/api/message-drafts/d1/approve' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ...baseDraft, status: 'queued' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtDraft('d1');
    await screen.findByText('등원 안내 발송');

    fireEvent.click(screen.getByRole('button', { name: '수신자 미리보기' }));
    await screen.findByText(/발송대상 2명/);

    fireEvent.change(screen.getByLabelText('발송 기기'), { target: { value: 'dev1' } });
    fireEvent.click(screen.getByRole('button', { name: '승인' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/message-drafts/d1/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sendMode: 'immediate', deviceId: 'dev1', confirmOptOutOverride: false }),
        })
      )
    );
  });
});
