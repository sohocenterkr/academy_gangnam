import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ApiRequestError, apiDelete, apiGet, apiPost } from '../../lib/apiClient';

interface CourseSchedule {
  id: string;
  courseId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  classroom: string | null;
  isActive: boolean;
}

interface Course {
  id: string;
  code: string;
  name: string;
  category: string | null;
  status: string;
  updatedAt: string;
  schedules: CourseSchedule[];
  activeEnrollmentCount: number;
}

interface CourseException {
  id: string;
  courseId: string;
  exceptionType: string;
  eventDate: string;
  reason: string | null;
}

interface Enrollment {
  id: string;
  studentId: string;
  courseId: string;
  startDate: string;
  plannedEndDate: string | null;
  status: string;
  tuitionAmount: number | null;
  updatedAt: string;
}

interface EnrollmentConflict {
  id: string;
  startDate: string;
  plannedEndDate: string | null;
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const EXCEPTION_TYPE_OPTIONS = [
  { value: 'cancellation', label: '휴강' },
  { value: 'makeup', label: '보강' },
];

export function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;

  const [course, setCourse] = useState<Course | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [exceptions, setExceptions] = useState<CourseException[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [dayOfWeek, setDayOfWeek] = useState('0');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [classroom, setClassroom] = useState('');

  const [exceptionType, setExceptionType] = useState('cancellation');
  const [eventDate, setEventDate] = useState('');
  const [reason, setReason] = useState('');

  const [studentId, setStudentId] = useState('');
  const [enrollStartDate, setEnrollStartDate] = useState('');
  const [tuitionAmount, setTuitionAmount] = useState('');
  const [overlapConflicts, setOverlapConflicts] = useState<EnrollmentConflict[] | null>(null);

  async function reloadCourse() {
    if (!courseId) return;
    const data = await apiGet<Course>(`/api/courses/${courseId}`);
    setCourse(data);
  }

  async function reloadEnrollments() {
    if (!courseId) return;
    const data = await apiGet<Enrollment[]>(`/api/enrollments?courseId=${courseId}`);
    setEnrollments(data);
  }

  useEffect(() => {
    if (!courseId) return;

    async function load() {
      try {
        await Promise.all([reloadCourse(), reloadEnrollments()]);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function handleAddSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course) return;
    setError(null);
    try {
      await apiPost(`/api/courses/${course.id}/schedules`, {
        dayOfWeek: Number(dayOfWeek),
        startTime,
        endTime,
        classroom: classroom || undefined,
      });
      setStartTime('');
      setEndTime('');
      setClassroom('');
      await reloadCourse();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '일정을 추가하지 못했습니다.');
    }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    setError(null);
    try {
      await apiDelete(`/api/course-schedules/${scheduleId}`);
      await reloadCourse();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '일정을 삭제하지 못했습니다.');
    }
  }

  async function handleAddException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course) return;
    setError(null);
    try {
      const created = await apiPost<CourseException>(`/api/courses/${course.id}/exceptions`, {
        exceptionType,
        eventDate,
        reason: reason || undefined,
      });
      setExceptions((prev) => [...prev, created]);
      setEventDate('');
      setReason('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '휴강·보강 일정을 추가하지 못했습니다.');
    }
  }

  async function handleDeleteException(exceptionId: string) {
    setError(null);
    try {
      await apiDelete(`/api/course-exceptions/${exceptionId}`);
      setExceptions((prev) => prev.filter((item) => item.id !== exceptionId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '휴강·보강 일정을 삭제하지 못했습니다.');
    }
  }

  async function submitEnrollment(confirmOverlap: boolean) {
    if (!course) return;
    setError(null);
    try {
      await apiPost('/api/enrollments', {
        studentId,
        courseId: course.id,
        startDate: enrollStartDate,
        tuitionAmount: tuitionAmount ? Number(tuitionAmount) : undefined,
        ...(confirmOverlap ? { confirmOverlap: true } : {}),
      });
      setOverlapConflicts(null);
      setStudentId('');
      setEnrollStartDate('');
      setTuitionAmount('');
      await reloadEnrollments();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'PERIOD_OVERLAP') {
        const data = err.data as { conflicts?: EnrollmentConflict[] } | undefined;
        setOverlapConflicts(data?.conflicts ?? []);
        setError(err.message);
        return;
      }
      setError(err instanceof ApiRequestError ? err.message : '수강 등록에 실패했습니다.');
    }
  }

  async function handleEnroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitEnrollment(false);
  }

  async function handleEndEnrollment(enrollmentId: string) {
    setError(null);
    try {
      await apiPost(`/api/enrollments/${enrollmentId}/end`, {});
      await reloadEnrollments();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '종료 처리에 실패했습니다.');
    }
  }

  async function handleCancelEnrollment(enrollmentId: string) {
    setError(null);
    try {
      await apiPost(`/api/enrollments/${enrollmentId}/cancel`, {});
      await reloadEnrollments();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '취소 처리에 실패했습니다.');
    }
  }

  if (!course) {
    return (
      <section className="p-4">
        {error ? (
          <>
            <Link href="/admin/courses" className="text-blue-600 underline">
              목록으로
            </Link>
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          </>
        ) : (
          <p className="text-gray-500">불러오는 중...</p>
        )}
      </section>
    );
  }

  return (
    <section className="p-4">
      <Link href="/admin/courses" className="text-blue-600 underline">
        목록으로
      </Link>
      <h1 className="mt-2 text-xl font-semibold">{course.name}</h1>
      <p className="text-gray-600">
        {course.code} {course.category && <span className="ml-2">{course.category}</span>}
      </p>
      <p className="text-sm text-gray-500">활성 수강 등록: {course.activeEnrollmentCount}건</p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-6 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">일정</h2>
        <ul className="mt-2 space-y-2">
          {course.schedules.map((schedule) => (
            <li key={schedule.id} className="flex items-center justify-between rounded border border-gray-100 p-2">
              <span>
                {DAY_LABELS[schedule.dayOfWeek]}요일 {schedule.startTime}-{schedule.endTime}
                {schedule.classroom && <span className="ml-2 text-gray-500">{schedule.classroom}</span>}
              </span>
              <button type="button" onClick={() => handleDeleteSchedule(schedule.id)} className="text-sm text-red-600 underline">
                삭제
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAddSchedule} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>요일</span>
            <select value={dayOfWeek} onChange={(event) => setDayOfWeek(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
              {DAY_LABELS.map((label, index) => (
                <option key={index} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>시작 시간</span>
            <input value={startTime} onChange={(event) => setStartTime(event.target.value)} placeholder="HH:MM" required className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1">
            <span>종료 시간</span>
            <input value={endTime} onChange={(event) => setEndTime(event.target.value)} placeholder="HH:MM" required className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1">
            <span>강의실</span>
            <input value={classroom} onChange={(event) => setClassroom(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>
          <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
            일정 추가
          </button>
        </form>
      </div>

      <div className="mt-6 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">휴강·보강</h2>
        <p className="mt-1 text-xs text-gray-500">
          이 목록은 현재 화면에서 추가한 항목만 보여줍니다. 새로고침하면 이전에 추가된 휴강·보강 내역은 다시 불러올 수 없습니다.
        </p>
        <ul className="mt-2 space-y-2">
          {exceptions.map((item) => (
            <li key={item.id} className="flex items-center justify-between rounded border border-gray-100 p-2">
              <span>
                {EXCEPTION_TYPE_OPTIONS.find((option) => option.value === item.exceptionType)?.label ?? item.exceptionType} {item.eventDate}
                {item.reason && <span className="ml-2 text-gray-500">{item.reason}</span>}
              </span>
              <button type="button" onClick={() => handleDeleteException(item.id)} className="text-sm text-red-600 underline">
                삭제
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAddException} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>구분</span>
            <select value={exceptionType} onChange={(event) => setExceptionType(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
              {EXCEPTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>날짜</span>
            <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1">
            <span>사유</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>
          <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
            휴강·보강 추가
          </button>
        </form>
      </div>

      <div className="mt-6 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">수강생</h2>
        <ul className="mt-2 space-y-2">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id} className="flex items-center justify-between rounded border border-gray-100 p-2">
              <span>
                학생 ID: {enrollment.studentId} ({enrollment.startDate} ~ {enrollment.plannedEndDate ?? '미정'}) 상태: {enrollment.status}
              </span>
              <span className="flex gap-2">
                <button type="button" onClick={() => handleEndEnrollment(enrollment.id)} className="text-sm text-gray-700 underline">
                  종료
                </button>
                <button type="button" onClick={() => handleCancelEnrollment(enrollment.id)} className="text-sm text-red-600 underline">
                  취소
                </button>
              </span>
            </li>
          ))}
        </ul>

        <form onSubmit={handleEnroll} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>학생 ID</span>
            <input value={studentId} onChange={(event) => setStudentId(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1">
            <span>시작일</span>
            <input type="date" value={enrollStartDate} onChange={(event) => setEnrollStartDate(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1">
            <span>수강료</span>
            <input value={tuitionAmount} onChange={(event) => setTuitionAmount(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base" />
          </label>

          {overlapConflicts && (
            <div role="alert" className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm">
              <p>기존 수강 기간과 겹칩니다:</p>
              <ul className="mt-1 list-disc pl-5">
                {overlapConflicts.map((conflict) => (
                  <li key={conflict.id}>
                    {conflict.startDate} ~ {conflict.plannedEndDate ?? '미정'}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => submitEnrollment(true)} className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white">
                그래도 등록
              </button>
            </div>
          )}

          <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
            수강 등록
          </button>
        </form>
      </div>
    </section>
  );
}
