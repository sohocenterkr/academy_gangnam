import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface MaskedStudent {
  id: string;
  name: string;
  phoneNormalized: string;
  schoolId: string | null;
  gradeLevelId: string;
  status: string;
  registrationDate: string;
  updatedAt: string;
}

interface GradeLevel {
  id: string;
  name: string;
}

interface School {
  id: string;
  name: string;
}

interface DuplicateCandidate {
  id: string;
  name: string;
  phoneNormalized: string;
}

type CreateStudentResponse =
  | { status: 'created'; student: { id: string } }
  | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

const STATUS_LABELS: Record<string, string> = {
  enrolled: '재원',
  paused: '휴원',
  withdrawn: '퇴원',
  graduated: '졸업',
};

export function StudentListPage() {
  const [students, setStudents] = useState<MaskedStudent[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStudents(query?: string) {
    const path = query ? `/api/students?search=${encodeURIComponent(query)}` : '/api/students';
    setStudents(await apiGet<MaskedStudent[]>(path));
  }

  useEffect(() => {
    async function load() {
      try {
        const [gradeList, schoolList] = await Promise.all([apiGet<GradeLevel[]>('/api/grade-levels'), apiGet<School[]>('/api/schools')]);
        setGradeLevels(gradeList);
        setSchools(schoolList);
        await loadStudents();
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void load();
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await loadStudents(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '검색하지 못했습니다.');
    }
  }

  async function submitCreate(confirmDuplicate: boolean) {
    setError(null);
    try {
      const response = await apiPost<CreateStudentResponse>('/api/students', { name, phone, gradeLevelId, schoolId: schoolId || undefined, confirmDuplicate });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        return;
      }
      setDuplicates(null);
      setName('');
      setPhone('');
      setGradeLevelId('');
      setSchoolId('');
      await loadStudents(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학생을 등록하지 못했습니다.');
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitCreate(false);
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">학생 관리</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <form onSubmit={handleSearch} className="mt-4 flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span>검색</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="이름 또는 전화번호"
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <button type="submit" className="self-end rounded bg-gray-200 px-4 py-2">
          검색
        </button>
      </form>

      <ul className="mt-4 space-y-2">
        {students.map((student) => (
          <li key={student.id} className="rounded border border-gray-200 p-2">
            <Link href={`/admin/students/${student.id}`} className="text-blue-600 underline">
              {student.name}
            </Link>
            <span className="ml-2 text-gray-600">{student.phoneNormalized}</span>
            <span className="ml-2 text-sm text-gray-500">{STATUS_LABELS[student.status] ?? student.status}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 학생 등록</h2>
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
          <span>학년</span>
          <select
            value={gradeLevelId}
            onChange={(event) => setGradeLevelId(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          >
            <option value="">선택</option>
            {gradeLevels.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>학교</span>
          <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
            <option value="">선택 안 함</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>

        {duplicates && duplicates.length > 0 && (
          <div role="alert" className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm">
            <p>이미 등록된 전화번호와 일치하는 학생이 있습니다:</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.map((candidate) => (
                <li key={candidate.id}>
                  <Link href={`/admin/students/${candidate.id}`} className="underline">
                    {candidate.name}
                  </Link>{' '}
                  ({candidate.phoneNormalized})
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => submitCreate(true)} className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white">
              그래도 등록
            </button>
          </div>
        )}

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          학생 등록
        </button>
      </form>
    </section>
  );
}
