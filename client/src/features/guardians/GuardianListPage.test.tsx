import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuardianListPage } from './GuardianListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

describe('GuardianListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the guardian list and creates a new guardian', async () => {
    const guardiansState = [{ id: 'g1', name: '김*수', phoneNormalized: '010-****-5678', notes: null, updatedAt: '2026-08-15T00:00:00+09:00' }];

    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/guardians') && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(guardiansState));
      }
      if (path === '/api/guardians' && init?.method === 'POST') {
        const created = { id: 'g2', name: '새보호자', phoneNormalized: '01011112222', notes: null, updatedAt: '2026-08-15T00:05:00+09:00' };
        guardiansState.push({ id: 'g2', name: '새*자', phoneNormalized: '010-****-2222', notes: null, updatedAt: created.updatedAt });
        return Promise.resolve(jsonResponse({ status: 'created', guardian: created }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GuardianListPage />);

    await screen.findByText('김*수');

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새보호자' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-1111-2222' } });
    fireEvent.click(screen.getByRole('button', { name: '보호자 등록' }));

    await waitFor(() => expect(screen.getByText('새*자')).toBeInTheDocument());
  });

  it('shows a duplicate warning and requires confirmation before creating', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/guardians') && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse([]));
      }
      if (path === '/api/guardians' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { confirmDuplicate?: boolean };
        if (!body.confirmDuplicate) {
          return Promise.resolve(
            jsonResponse({ status: 'duplicate_warning', duplicates: [{ id: 'g1', name: '김*수', phoneNormalized: '010-****-5678' }] })
          );
        }
        return Promise.resolve(
          jsonResponse({ status: 'created', guardian: { id: 'g3', name: '중복보호자', phoneNormalized: '01099998888', notes: null, updatedAt: '2026-08-15T00:00:00+09:00' } })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GuardianListPage />);
    await screen.findByRole('button', { name: '보호자 등록' });

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '중복보호자' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-9999-8888' } });
    fireEvent.click(screen.getByRole('button', { name: '보호자 등록' }));

    await screen.findByText(/이미 등록된 전화번호/);
    expect(screen.getByRole('link', { name: '김*수' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '그래도 등록' }));

    await waitFor(() => expect(screen.queryByText(/이미 등록된 전화번호/)).not.toBeInTheDocument());
  });
});
