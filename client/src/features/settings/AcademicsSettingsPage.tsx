import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

interface School {
  id: string;
  name: string;
  region: string | null;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}

interface GradeLevel {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}

export function AcademicsSettingsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newGradeLevelName, setNewGradeLevelName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadSchools() {
    setSchools(await apiGet<School[]>('/api/schools'));
  }

  async function loadGradeLevels() {
    setGradeLevels(await apiGet<GradeLevel[]>('/api/grade-levels'));
  }

  useEffect(() => {
    async function load() {
      try {
        await Promise.all([loadSchools(), loadGradeLevels()]);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void load();
  }, []);

  async function handleAddSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/schools', { name: newSchoolName });
      setNewSchoolName('');
      await loadSchools();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학교를 등록하지 못했습니다.');
    }
  }

  async function handleToggleSchool(school: School) {
    setError(null);
    try {
      await apiPatch(`/api/schools/${school.id}`, {
        isActive: !school.isActive,
        expectedUpdatedAt: school.updatedAt,
      });
      await loadSchools();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학교를 수정하지 못했습니다.');
    }
  }

  async function handleDeleteSchool(school: School) {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    setError(null);
    try {
      await apiDelete(`/api/schools/${school.id}`);
      await loadSchools();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학교를 삭제하지 못했습니다.');
    }
  }

  async function handleAddGradeLevel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/grade-levels', { name: newGradeLevelName });
      setNewGradeLevelName('');
      await loadGradeLevels();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학년을 등록하지 못했습니다.');
    }
  }

  async function handleToggleGradeLevel(gradeLevel: GradeLevel) {
    setError(null);
    try {
      await apiPatch(`/api/grade-levels/${gradeLevel.id}`, {
        isActive: !gradeLevel.isActive,
        expectedUpdatedAt: gradeLevel.updatedAt,
      });
      await loadGradeLevels();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학년을 수정하지 못했습니다.');
    }
  }

  async function handleDeleteGradeLevel(gradeLevel: GradeLevel) {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    setError(null);
    try {
      await apiDelete(`/api/grade-levels/${gradeLevel.id}`);
      await loadGradeLevels();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학년을 삭제하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">학교·학년 기준정보</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-6">
        <h2 className="text-lg font-medium">학교</h2>
        <ul className="mt-2 space-y-2">
          {schools.map((school) => (
            <li key={school.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2">
              <span className={school.isActive ? '' : 'text-gray-400 line-through'}>{school.name}</span>
              <span className="flex gap-2">
                <button onClick={() => handleToggleSchool(school)} className="rounded bg-gray-200 px-2 py-1 text-sm">
                  {school.isActive ? '비활성화' : '활성화'}
                </button>
                <button onClick={() => handleDeleteSchool(school)} className="rounded bg-red-100 px-2 py-1 text-sm text-red-700">
                  삭제
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddSchool} className="mt-3 flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span>새 학교 이름</span>
            <input
              value={newSchoolName}
              onChange={(event) => setNewSchoolName(event.target.value)}
              required
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <button type="submit" className="self-end rounded bg-blue-600 px-4 py-2 text-white">
            학교 추가
          </button>
        </form>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-medium">학년</h2>
        <ul className="mt-2 space-y-2">
          {gradeLevels.map((gradeLevel) => (
            <li
              key={gradeLevel.id}
              className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2"
            >
              <span className={gradeLevel.isActive ? '' : 'text-gray-400 line-through'}>{gradeLevel.name}</span>
              <span className="flex gap-2">
                <button onClick={() => handleToggleGradeLevel(gradeLevel)} className="rounded bg-gray-200 px-2 py-1 text-sm">
                  {gradeLevel.isActive ? '비활성화' : '활성화'}
                </button>
                <button
                  onClick={() => handleDeleteGradeLevel(gradeLevel)}
                  className="rounded bg-red-100 px-2 py-1 text-sm text-red-700"
                >
                  삭제
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddGradeLevel} className="mt-3 flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span>새 학년 이름</span>
            <input
              value={newGradeLevelName}
              onChange={(event) => setNewGradeLevelName(event.target.value)}
              required
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <button type="submit" className="self-end rounded bg-blue-600 px-4 py-2 text-white">
            학년 추가
          </button>
        </form>
      </div>
    </section>
  );
}
