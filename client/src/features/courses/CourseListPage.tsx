import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface Course {
  id: string;
  code: string;
  name: string;
  category: string | null;
  instructorId: string | null;
  status: string;
  updatedAt: string;
}

const STATUS_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'recruiting', label: '모집중' },
  { value: 'closed', label: '마감' },
  { value: 'ended', label: '종료' },
  { value: 'inactive', label: '비활성' },
];

export function CourseListPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [instructorId, setInstructorId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadCourses(status: string) {
    const query = status ? `?status=${status}` : '';
    setCourses(await apiGet<Course[]>(`/api/courses${query}`));
  }

  useEffect(() => {
    async function load() {
      try {
        await loadCourses(statusFilter);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void load();
  }, [statusFilter]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/courses', {
        code,
        name,
        category: category || undefined,
        instructorId: instructorId || undefined,
      });
      setCode('');
      setName('');
      setCategory('');
      setInstructorId('');
      await loadCourses(statusFilter);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '강좌를 등록하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">강좌 관리</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <label className="mt-4 flex flex-col gap-1">
        <span>상태</span>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-base"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <ul className="mt-4 space-y-2">
        {courses.map((course) => (
          <li key={course.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2">
            <div>
              <Link href={`/admin/courses/${course.id}`} className="text-blue-600 underline">
                {course.name}
              </Link>
              <span className="ml-2 text-gray-600">{course.code}</span>
              {course.category && <span className="ml-2 text-gray-500">{course.category}</span>}
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 강좌 등록</h2>
        <label className="flex flex-col gap-1">
          <span>강좌 코드</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>강좌명</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>분류</span>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>담당 강사 ID</span>
          <input
            value={instructorId}
            onChange={(event) => setInstructorId(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          강좌 등록
        </button>
      </form>
    </section>
  );
}
