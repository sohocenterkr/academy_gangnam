import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { StudentDetailPage } from './StudentDetailPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

function renderAtStudentDetail(studentId: string) {
  const { hook } = memoryLocation({ path: `/admin/students/${studentId}`, static: true });
  return render(
    <Router hook={hook}>
      <Route path="/admin/students/:studentId">
        <StudentDetailPage />
      </Route>
    </Router>
  );
}

const baseStudent = {
  id: 'st1',
  name: '김철수',
  phoneNormalized: '01012345678',
  schoolId: null,
  gradeLevelId: 'g1',
  birthDate: null,
  address: null,
  registrationDate: '2026-08-15',
  status: 'enrolled',
  statusEffectiveDate: '2026-08-15',
  specialNotes: null,
  counselingNotes: null,
  updatedAt: '2026-08-15T00:00:00+09:00',
  guardians: [],
};

describe('StudentDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the full unmasked student and saves an edit', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/students/st1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseStudent));
      if (path === '/api/students/st1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ status: 'updated', student: { ...baseStudent, specialNotes: '새 메모', updatedAt: '2026-08-15T00:10:00+09:00' } }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtStudentDetail('st1');

    const nameInput = await screen.findByLabelText('이름');
    expect(nameInput).toHaveValue('김철수');

    fireEvent.change(screen.getByLabelText('특이사항'), { target: { value: '새 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText('저장되었습니다.')).toBeInTheDocument());
  });

  it('links an existing guardian found via search', async () => {
    const linkedGuardians: unknown[] = [];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/students/st1' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ ...baseStudent, guardians: linkedGuardians }));
      }
      if (path.startsWith('/api/guardians?search=')) {
        return Promise.resolve(jsonResponse([{ id: 'gd1', name: '이보호', phoneNormalized: '010-****-9999', notes: null, updatedAt: '2026-08-15T00:00:00+09:00' }]));
      }
      if (path === '/api/students/st1/guardians' && init?.method === 'POST') {
        const link = { id: 'link1', relationship: null, isPrimary: false, receiveMessages: true, useForCheckin: true, updatedAt: '2026-08-15T00:00:00+09:00' };
        linkedGuardians.push({ ...link, guardian: { id: 'gd1', name: '이보호', phoneNormalized: '01099998888', notes: null } });
        return Promise.resolve(jsonResponse(link));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtStudentDetail('st1');
    await screen.findByLabelText('이름');

    fireEvent.change(screen.getByLabelText('보호자 검색'), { target: { value: '이보호' } });
    fireEvent.click(screen.getByRole('button', { name: '보호자 검색' }));

    await screen.findByText('이보호');
    fireEvent.click(screen.getByRole('button', { name: '연결' }));

    await waitFor(() => expect(screen.getByText('01099998888')).toBeInTheDocument());
  });

  it('deletes the student after confirmation and navigates back to the list', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/students/st1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseStudent));
      if (path === '/api/students/st1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse({ success: true }));
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', () => true);

    renderAtStudentDetail('st1');

    await screen.findByLabelText('이름');
    fireEvent.click(screen.getByRole('button', { name: '학생 삭제' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/students/st1', expect.objectContaining({ method: 'DELETE' }))
    );
  });
});
