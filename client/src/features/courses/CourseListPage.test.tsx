import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { CourseListPage } from './CourseListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-16T00:00:00+09:00' } }),
  };
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<Router>{ui}</Router>);
}

describe('CourseListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and renders the course list', async () => {
    const rows = [
      {
        id: 'c1',
        code: 'MATH-1',
        name: '수학 기초반',
        category: '수학',
        instructorId: null,
        status: 'recruiting',
        updatedAt: '2026-08-16T00:00:00.000Z',
      },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/courses' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(rows));
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithRouter(<CourseListPage />);

    await screen.findByText('수학 기초반');
    expect(screen.getByText('MATH-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '수학 기초반' })).toHaveAttribute('href', '/admin/courses/c1');
  });

  it('re-fetches with a status query string when the filter changes', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/courses' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse([]));
      if (path === '/api/courses?status=recruiting' && (!init || init.method === undefined))
        return Promise.resolve(jsonResponse([]));
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithRouter(<CourseListPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/courses', { headers: { Accept: 'application/json' } })
    );

    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'recruiting' } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/courses?status=recruiting', {
        headers: { Accept: 'application/json' },
      })
    );
  });

  it('submits the create form and reloads the list', async () => {
    let created = false;
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/courses' && (!init || init.method === undefined)) {
        return Promise.resolve(
          jsonResponse(
            created
              ? [
                  {
                    id: 'c2',
                    code: 'ENG-1',
                    name: '영어 심화반',
                    category: '영어',
                    instructorId: 'i1',
                    status: 'recruiting',
                    updatedAt: '2026-08-16T00:00:00.000Z',
                  },
                ]
              : []
          )
        );
      }
      if (path === '/api/courses' && init?.method === 'POST') {
        created = true;
        return Promise.resolve(
          jsonResponse({
            id: 'c2',
            code: 'ENG-1',
            name: '영어 심화반',
            category: '영어',
            instructorId: 'i1',
            status: 'recruiting',
            updatedAt: '2026-08-16T00:00:00.000Z',
          })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithRouter(<CourseListPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/courses', { headers: { Accept: 'application/json' } })
    );

    fireEvent.change(screen.getByLabelText('강좌 코드'), { target: { value: 'ENG-1' } });
    fireEvent.change(screen.getByLabelText('강좌명'), { target: { value: '영어 심화반' } });
    fireEvent.change(screen.getByLabelText('분류'), { target: { value: '영어' } });
    fireEvent.change(screen.getByLabelText('담당 강사 ID'), { target: { value: 'i1' } });
    fireEvent.click(screen.getByRole('button', { name: '강좌 등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ code: 'ENG-1', name: '영어 심화반', category: '영어', instructorId: 'i1' }),
        })
      )
    );

    await screen.findByText('영어 심화반');
  });
});
