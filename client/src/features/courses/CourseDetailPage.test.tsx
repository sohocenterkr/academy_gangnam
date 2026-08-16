import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CourseDetailPage } from './CourseDetailPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

function errorResponse(status: number, code: string, message: string, data?: unknown) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message, requestId: 'req' }, ...(data !== undefined ? { data } : {}) }),
  };
}

function renderAtCourseDetail(courseId: string) {
  const { hook } = memoryLocation({ path: `/admin/courses/${courseId}`, static: true });
  return render(
    <Router hook={hook}>
      <Route path="/admin/courses/:courseId">
        <CourseDetailPage />
      </Route>
    </Router>
  );
}

const baseCourse = {
  id: 'c1',
  code: 'MATH-1',
  name: '수학 기초반',
  category: '수학',
  instructorId: null,
  classroom: null,
  capacity: null,
  baseFee: null,
  startDate: null,
  endDate: null,
  status: 'recruiting',
  description: null,
  updatedAt: '2026-08-15T00:00:00+09:00',
  schedules: [{ id: 'sch1', courseId: 'c1', dayOfWeek: 1, startTime: '10:00', endTime: '11:00', classroom: '201호', isActive: true }],
  activeEnrollmentCount: 1,
};

const baseEnrollments = [
  { id: 'en1', studentId: 'st1', courseId: 'c1', startDate: '2026-08-01', plannedEndDate: null, status: 'active', tuitionAmount: 100000, updatedAt: '2026-08-15T00:00:00+09:00' },
];

describe('CourseDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and renders course info, schedules, and enrollments', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/courses/c1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseCourse));
      if (path === '/api/enrollments?courseId=c1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseEnrollments));
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtCourseDetail('c1');

    await screen.findByText('수학 기초반');
    expect(screen.getByText('201호')).toBeInTheDocument();
    expect(screen.getByText(/st1/)).toBeInTheDocument();
  });

  it('adds a schedule via the inline form', async () => {
    const fetchMock = vi.fn();
    let scheduleAdded = false;
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/courses/c1' && (!init || init.method === undefined)) {
        return Promise.resolve(
          jsonResponse(scheduleAdded ? { ...baseCourse, schedules: [...baseCourse.schedules, { id: 'sch2', courseId: 'c1', dayOfWeek: 3, startTime: '14:00', endTime: '15:00', classroom: '302호', isActive: true }] } : baseCourse)
        );
      }
      if (path === '/api/enrollments?courseId=c1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseEnrollments));
      if (path === '/api/courses/c1/schedules' && init?.method === 'POST') {
        scheduleAdded = true;
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ dayOfWeek: 3, startTime: '14:00', endTime: '15:00', classroom: '302호' });
        return Promise.resolve(jsonResponse({ id: 'sch2', courseId: 'c1', ...body, isActive: true }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtCourseDetail('c1');
    await screen.findByText('수학 기초반');

    fireEvent.change(screen.getByLabelText('요일'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('시작 시간'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('종료 시간'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('강의실'), { target: { value: '302호' } });
    fireEvent.click(screen.getByRole('button', { name: '일정 추가' }));

    await waitFor(() => expect(screen.getByText('302호')).toBeInTheDocument());
  });

  it('adds an enrollment and asserts the request body', async () => {
    const fetchMock = vi.fn();
    let enrolled = false;
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/courses/c1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseCourse));
      if (path === '/api/enrollments?courseId=c1' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(enrolled ? [...baseEnrollments, { id: 'en2', studentId: 'st2', courseId: 'c1', startDate: '2026-09-01', plannedEndDate: null, status: 'active', tuitionAmount: 150000, updatedAt: '2026-08-15T00:00:00+09:00' }] : baseEnrollments));
      }
      if (path === '/api/enrollments' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ studentId: 'st2', courseId: 'c1', startDate: '2026-09-01', tuitionAmount: 150000 });
        enrolled = true;
        return Promise.resolve(jsonResponse({ id: 'en2', ...body, status: 'active', updatedAt: '2026-08-15T00:00:00+09:00' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtCourseDetail('c1');
    await screen.findByText('수학 기초반');

    fireEvent.change(screen.getByLabelText('학생 ID'), { target: { value: 'st2' } });
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('수강료'), { target: { value: '150000' } });
    fireEvent.click(screen.getByRole('button', { name: '수강 등록' }));

    await waitFor(() => expect(screen.getByText(/st2/)).toBeInTheDocument());
  });

  it('shows a PERIOD_OVERLAP conflict and resubmits with confirmOverlap on 그래도 등록', async () => {
    const fetchMock = vi.fn();
    let confirmed = false;
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/courses/c1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseCourse));
      if (path === '/api/enrollments?courseId=c1' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(confirmed ? [...baseEnrollments, { id: 'en2', studentId: 'st2', courseId: 'c1', startDate: '2026-09-01', plannedEndDate: null, status: 'active', tuitionAmount: 150000, updatedAt: '2026-08-15T00:00:00+09:00' }] : baseEnrollments));
      }
      if (path === '/api/enrollments' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        if (!body.confirmOverlap) {
          expect(body).toEqual({ studentId: 'st2', courseId: 'c1', startDate: '2026-09-01', tuitionAmount: 150000 });
          return Promise.resolve(
            errorResponse(409, 'PERIOD_OVERLAP', '기존 수강 기간과 겹칩니다. 계속하려면 확인이 필요합니다.', {
              conflicts: [{ id: 'en1', startDate: '2026-08-01', plannedEndDate: null }],
            })
          );
        }
        expect(body).toEqual({ studentId: 'st2', courseId: 'c1', startDate: '2026-09-01', tuitionAmount: 150000, confirmOverlap: true });
        confirmed = true;
        return Promise.resolve(jsonResponse({ id: 'en2', ...body, status: 'active', updatedAt: '2026-08-15T00:00:00+09:00' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtCourseDetail('c1');
    await screen.findByText('수학 기초반');

    fireEvent.change(screen.getByLabelText('학생 ID'), { target: { value: 'st2' } });
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('수강료'), { target: { value: '150000' } });
    fireEvent.click(screen.getByRole('button', { name: '수강 등록' }));

    await screen.findByRole('button', { name: '그래도 등록' });
    fireEvent.click(screen.getByRole('button', { name: '그래도 등록' }));

    await waitFor(() => expect(screen.getByText(/st2/)).toBeInTheDocument());
  });
});
