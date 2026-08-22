import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RolesPage } from './RolesPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('RolesPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads roles and creates a new one', async () => {
    const roles = [{ id: 'r1', name: '강사', permissions: ['courses:manage'], isSystem: false, updatedAt: '2026-08-22T00:00:00Z' }];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/roles' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(roles));
      if (path === '/api/roles' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'r2', name: '문자담당자', permissions: ['messaging:manage'], isSystem: false, updatedAt: '' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RolesPage />);
    await screen.findByText('강사');

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '문자담당자' } });
    const messagingCheckboxes = screen.getAllByLabelText('messaging:manage');
    fireEvent.click(messagingCheckboxes[messagingCheckboxes.length - 1]!);
    fireEvent.click(screen.getByRole('button', { name: '역할 등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/roles',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '문자담당자', permissions: ['messaging:manage'] }) })
      )
    );
  });

  it('toggles a permission on an existing role', async () => {
    const roles = [{ id: 'r1', name: '강사', permissions: ['courses:manage'], isSystem: false, updatedAt: '2026-08-22T00:00:00Z' }];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/roles' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(roles));
      if (path === '/api/roles/r1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...roles[0], permissions: ['courses:manage', 'checkins:manage'] }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RolesPage />);
    await screen.findByText('강사');

    fireEvent.click(screen.getAllByLabelText('checkins:manage')[0]!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/roles/r1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ permissions: ['courses:manage', 'checkins:manage'], expectedUpdatedAt: '2026-08-22T00:00:00Z' }),
        })
      )
    );
  });
});
