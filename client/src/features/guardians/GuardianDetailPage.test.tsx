import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { GuardianDetailPage } from './GuardianDetailPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

function renderAtGuardianDetail(guardianId: string) {
  const { hook } = memoryLocation({ path: `/admin/guardians/${guardianId}`, static: true });
  return render(
    <Router hook={hook}>
      <Route path="/admin/guardians/:guardianId">
        <GuardianDetailPage />
      </Route>
    </Router>
  );
}

describe('GuardianDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the full unmasked guardian and saves an edit', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'g1', name: '김철수', phoneNormalized: '01012345678', notes: '기존 메모', updatedAt: '2026-08-15T00:00:00+09:00' })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'updated', guardian: { id: 'g1', name: '김철수', phoneNormalized: '01012345678', notes: '새 메모', updatedAt: '2026-08-15T00:10:00+09:00' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAtGuardianDetail('g1');

    const notesInput = await screen.findByLabelText('메모');
    expect(notesInput).toHaveValue('기존 메모');

    fireEvent.change(notesInput, { target: { value: '새 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText('저장되었습니다.')).toBeInTheDocument());
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PATCH' });
  });

  it('shows the error and a way back when loading the guardian fails', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { code: 'NOT_FOUND', message: '보호자를 찾을 수 없습니다.', requestId: 'req' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtGuardianDetail('missing-id');

    expect(await screen.findByText('보호자를 찾을 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '목록으로' })).toBeInTheDocument();
  });
});
