import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstructorListPage } from './InstructorListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-16T00:00:00+09:00' } }),
  };
}

describe('InstructorListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and renders the instructor list', async () => {
    const rows = [
      {
        id: 'i1',
        name: '김선생',
        phoneNormalized: '01011112222',
        subjects: ['수학', '영어'],
        status: 'active',
        updatedAt: '2026-08-16T00:00:00.000Z',
      },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/instructors' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(rows));
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<InstructorListPage />);

    await screen.findByText('김선생');
    expect(screen.getByText('01011112222')).toBeInTheDocument();
  });

  it('submits the create form and reloads the list', async () => {
    const fetchMock = vi.fn();
    let created = false;
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/instructors' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(created ? [
          { id: 'i2', name: '박선생', phoneNormalized: '01033334444', subjects: ['국어'], status: 'active', updatedAt: '2026-08-16T00:00:00.000Z' },
        ] : []));
      }
      if (path === '/api/instructors' && init?.method === 'POST') {
        created = true;
        return Promise.resolve(
          jsonResponse({ id: 'i2', name: '박선생', phoneNormalized: '01033334444', subjects: ['국어'], status: 'active', updatedAt: '2026-08-16T00:00:00.000Z' })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<InstructorListPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/instructors', { headers: { Accept: 'application/json' } })
    );

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '박선생' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '01033334444' } });
    fireEvent.change(screen.getByLabelText('담당 과목 (쉼표로 구분)'), { target: { value: '국어, 사회' } });
    fireEvent.click(screen.getByRole('button', { name: '강사 등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/instructors',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: '박선생', phoneNormalized: '01033334444', subjects: ['국어', '사회'] }),
        })
      )
    );

    await screen.findByText('박선생');
  });

  it('toggles an instructor status via PATCH with expectedUpdatedAt', async () => {
    const rows = [
      {
        id: 'i1',
        name: '김선생',
        phoneNormalized: '01011112222',
        subjects: ['수학'],
        status: 'active',
        updatedAt: '2026-08-16T00:00:00.000Z',
      },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/instructors' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(rows));
      if (path === '/api/instructors/i1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...rows[0], status: 'inactive', updatedAt: '2026-08-16T01:00:00.000Z' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<InstructorListPage />);

    await screen.findByText('김선생');
    fireEvent.click(screen.getByRole('button', { name: '비활성으로 변경' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/instructors/i1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'inactive', expectedUpdatedAt: '2026-08-16T00:00:00.000Z' }),
        })
      )
    );
  });
});
