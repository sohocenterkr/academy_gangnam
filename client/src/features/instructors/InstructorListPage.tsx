import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

interface Instructor {
  id: string;
  name: string;
  phoneNormalized: string;
  subjects: string[];
  status: string;
  updatedAt: string;
}

export function InstructorListPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subjects, setSubjects] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadInstructors() {
    setInstructors(await apiGet<Instructor[]>('/api/instructors'));
  }

  useEffect(() => {
    async function load() {
      try {
        await loadInstructors();
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void load();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/instructors', {
        name,
        phone,
        subjects: subjects
          .split(',')
          .map((subject) => subject.trim())
          .filter((subject) => subject.length > 0),
      });
      setName('');
      setPhone('');
      setSubjects('');
      await loadInstructors();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '강사를 등록하지 못했습니다.');
    }
  }

  async function handleToggleStatus(instructor: Instructor) {
    setError(null);
    try {
      await apiPatch(`/api/instructors/${instructor.id}`, {
        status: instructor.status === 'active' ? 'inactive' : 'active',
        expectedUpdatedAt: instructor.updatedAt,
      });
      await loadInstructors();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '강사 상태를 변경하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">강사 관리</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {instructors.map((instructor) => (
          <li
            key={instructor.id}
            className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2"
          >
            <div>
              <span className={instructor.status === 'active' ? '' : 'text-gray-400 line-through'}>
                {instructor.name}
              </span>
              <span className="ml-2 text-gray-600">{instructor.phoneNormalized}</span>
              <span className="ml-2 text-gray-500">{instructor.subjects.join(', ')}</span>
            </div>
            <button
              type="button"
              onClick={() => handleToggleStatus(instructor)}
              className="rounded bg-gray-200 px-2 py-1 text-sm"
            >
              {instructor.status === 'active' ? '비활성으로 변경' : '활성으로 변경'}
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 강사 등록</h2>
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>전화번호</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>담당 과목 (쉼표로 구분)</span>
          <input
            value={subjects}
            onChange={(event) => setSubjects(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          강사 등록
        </button>
      </form>
    </section>
  );
}
