import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcademicsSettingsPage } from './AcademicsSettingsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

describe('AcademicsSettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads schools and grade levels, and creates a new school', async () => {
    // Mutable in-memory list so a GET after the POST reflects the newly created row —
    // a static mock would make the new school vanish on the post-create refetch.
    const schoolsState = [
      { id: 'sc1', name: '기존초등학교', region: null, sortOrder: 0, isActive: true, updatedAt: '2026-08-15T00:00:00+09:00' },
    ];
    const gradeLevelsState = [
      { id: 'g1', name: '초등 1학년', sortOrder: 0, isActive: true, updatedAt: '2026-08-15T00:00:00+09:00' },
    ];

    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/schools' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(schoolsState));
      }
      if (path === '/api/grade-levels' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(gradeLevelsState));
      }
      if (path === '/api/schools' && init?.method === 'POST') {
        const created = { id: 'sc2', name: '새학교', region: null, sortOrder: 0, isActive: true, updatedAt: '2026-08-15T00:05:00+09:00' };
        schoolsState.push(created);
        return Promise.resolve(jsonResponse(created));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AcademicsSettingsPage />);

    await screen.findByText('기존초등학교');
    await screen.findByText('초등 1학년');

    fireEvent.change(screen.getByLabelText('새 학교 이름'), { target: { value: '새학교' } });
    fireEvent.click(screen.getByRole('button', { name: '학교 추가' }));

    await waitFor(() => expect(screen.getByText('새학교')).toBeInTheDocument());
  });
});
