import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentListPage } from './StudentListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

describe('StudentListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads grade levels, the student list, and creates a new student', async () => {
    const studentsState = [
      { id: 's1', name: '김*수', phoneNormalized: '010-****-5678', schoolId: null, gradeLevelId: 'g1', status: 'enrolled', registrationDate: '2026-08-15', updatedAt: '2026-08-15T00:00:00+09:00' },
    ];

    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/grade-levels') return Promise.resolve(jsonResponse([{ id: 'g1', name: '초1', sortOrder: 0, isActive: true }]));
      if (path === '/api/schools') return Promise.resolve(jsonResponse([]));
      if (path.startsWith('/api/students') && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(studentsState));
      }
      if (path === '/api/students' && init?.method === 'POST') {
        const created = { id: 's2', name: '새학생', phoneNormalized: '01011112222', gradeLevelId: 'g1', schoolId: null, status: 'enrolled', registrationDate: '2026-08-15', updatedAt: '2026-08-15T00:05:00+09:00' };
        studentsState.push({ ...created, name: '새*생', phoneNormalized: '010-****-2222' });
        return Promise.resolve(jsonResponse({ status: 'created', student: created }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StudentListPage />);

    await screen.findByText('김*수');
    await screen.findByRole('option', { name: '초1' });

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새학생' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-1111-2222' } });
    fireEvent.change(screen.getByLabelText('학년'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: '학생 등록' }));

    await waitFor(() => expect(screen.getByText('새*생')).toBeInTheDocument());
  });

  it('shows a duplicate warning and requires confirmation before creating', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/grade-levels') return Promise.resolve(jsonResponse([{ id: 'g1', name: '초1', sortOrder: 0, isActive: true }]));
      if (path === '/api/schools') return Promise.resolve(jsonResponse([]));
      if (path.startsWith('/api/students') && (!init || init.method === undefined)) return Promise.resolve(jsonResponse([]));
      if (path === '/api/students' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { confirmDuplicate?: boolean };
        if (!body.confirmDuplicate) {
          return Promise.resolve(
            jsonResponse({ status: 'duplicate_warning', duplicates: [{ id: 's1', name: '김*수', phoneNormalized: '010-****-5678' }] })
          );
        }
        return Promise.resolve(
          jsonResponse({
            status: 'created',
            student: { id: 's3', name: '중복학생', phoneNormalized: '01099998888', gradeLevelId: 'g1', schoolId: null, status: 'enrolled', registrationDate: '2026-08-15', updatedAt: '2026-08-15T00:00:00+09:00' },
          })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StudentListPage />);
    await screen.findByRole('option', { name: '초1' });

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '중복학생' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-9999-8888' } });
    fireEvent.change(screen.getByLabelText('학년'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: '학생 등록' }));

    await screen.findByText(/이미 등록된 전화번호/);
    fireEvent.click(screen.getByRole('button', { name: '그래도 등록' }));

    await waitFor(() => expect(screen.queryByText(/이미 등록된 전화번호/)).not.toBeInTheDocument());
  });

  it('uploads an Excel file and shows the import result', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/grade-levels') return Promise.resolve(jsonResponse([]));
      if (path === '/api/schools') return Promise.resolve(jsonResponse([]));
      if (path.startsWith('/api/students') && (!init || init.method === undefined)) return Promise.resolve(jsonResponse([]));
      if (path === '/api/students/import' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { fileBase64: string };
        expect(body.fileBase64).toBe('ZmFrZS14bHN4LWJ5dGVz');
        return Promise.resolve(jsonResponse({ createdCount: 2, errors: [{ row: 4, reason: '학년을 찾을 수 없습니다: 없는학년' }] }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StudentListPage />);
    await screen.findByText('학생 관리');

    const file = new File([Uint8Array.from(atob('ZmFrZS14bHN4LWJ5dGVz'), (c) => c.charCodeAt(0))], 'students.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = screen.getByText('엑셀 업로드(.xlsx)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/2명 등록됨/)).toBeInTheDocument());
    expect(screen.getByText(/4행: 학년을 찾을 수 없습니다/)).toBeInTheDocument();
  });
});
