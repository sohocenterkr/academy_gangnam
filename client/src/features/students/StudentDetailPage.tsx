import { type FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

interface LinkedGuardian {
  id: string;
  relationship: string | null;
  isPrimary: boolean;
  receiveMessages: boolean;
  useForCheckin: boolean;
  updatedAt: string;
  guardian: { id: string; name: string; phoneNormalized: string; notes: string | null };
}

interface Student {
  id: string;
  name: string;
  phoneNormalized: string;
  gradeLevelId: string;
  schoolId: string | null;
  address: string | null;
  status: string;
  statusEffectiveDate: string;
  specialNotes: string | null;
  counselingNotes: string | null;
  updatedAt: string;
  guardians: LinkedGuardian[];
}

interface DuplicateCandidate {
  id: string;
  name: string;
  phoneNormalized: string;
}

type UpdateStudentResponse = { status: 'updated'; student: Student } | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

interface GuardianSearchResult {
  id: string;
  name: string;
  phoneNormalized: string;
}

const STATUS_OPTIONS = [
  { value: 'enrolled', label: '재원' },
  { value: 'paused', label: '휴원' },
  { value: 'withdrawn', label: '퇴원' },
  { value: 'graduated', label: '졸업' },
];

export function StudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId;
  const [, navigate] = useLocation();

  const [student, setStudent] = useState<Student | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [specialNotes, setSpecialNotes] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [statusChoice, setStatusChoice] = useState('enrolled');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [guardianSearch, setGuardianSearch] = useState('');
  const [guardianResults, setGuardianResults] = useState<GuardianSearchResult[]>([]);

  async function reload() {
    if (!studentId) return;
    const data = await apiGet<Student>(`/api/students/${studentId}`);
    setStudent(data);
    setName(data.name);
    setPhone(data.phoneNormalized);
    setSpecialNotes(data.specialNotes ?? '');
    setStatusChoice(data.status);
  }

  useEffect(() => {
    if (!studentId) return;

    async function loadStudent() {
      try {
        await reload();
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }

    void loadStudent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  async function submitUpdate(confirmDuplicate: boolean) {
    if (!student) return;
    setError(null);
    try {
      const response = await apiPatch<UpdateStudentResponse>(`/api/students/${student.id}`, {
        name,
        phone,
        specialNotes,
        confirmDuplicate,
        expectedUpdatedAt: student.updatedAt,
      });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        return;
      }
      setDuplicates(null);
      await reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitUpdate(false);
  }

  async function handleStatusChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!student) return;
    setError(null);
    try {
      await apiPost(`/api/students/${student.id}/status`, { status: statusChoice });
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '상태를 변경하지 못했습니다.');
    }
  }

  async function handleGuardianSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const results = await apiGet<GuardianSearchResult[]>(`/api/guardians?search=${encodeURIComponent(guardianSearch)}`);
      setGuardianResults(results);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '보호자를 검색하지 못했습니다.');
    }
  }

  async function handleLinkGuardian(guardianId: string) {
    if (!student) return;
    setError(null);
    try {
      await apiPost(`/api/students/${student.id}/guardians`, { guardianId });
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '보호자를 연결하지 못했습니다.');
    }
  }

  async function handleUnlinkGuardian(linkId: string) {
    setError(null);
    try {
      await apiDelete(`/api/student-guardians/${linkId}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '연결을 해제하지 못했습니다.');
    }
  }

  async function handleDeleteStudent() {
    if (!student) return;
    if (!window.confirm(`'${student.name}' 학생을 삭제하시겠습니까? 삭제된 학생은 목록에서 보이지 않습니다.`)) return;
    setError(null);
    try {
      await apiDelete(`/api/students/${student.id}`);
      navigate('/admin/students');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학생을 삭제하지 못했습니다.');
    }
  }

  if (!student) {
    return (
      <section className="p-4">
        {error ? (
          <>
            <Link href="/admin/students" className="text-blue-600 underline">
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
      <Link href="/admin/students" className="text-blue-600 underline">
        목록으로
      </Link>
      <h1 className="mt-2 text-xl font-semibold">학생 상세</h1>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>전화번호</span>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>특이사항</span>
          <input value={specialNotes} onChange={(event) => setSpecialNotes(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base" />
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
            <button type="button" onClick={() => submitUpdate(true)} className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white">
              그래도 저장
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-green-700">저장되었습니다.</p>}

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          저장
        </button>
      </form>

      <form onSubmit={handleStatusChange} className="mt-6 flex flex-col gap-2 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">상태 변경</h2>
        <select value={statusChoice} onChange={(event) => setStatusChoice(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className="self-start rounded bg-gray-700 px-4 py-2 text-white">
          상태 변경
        </button>
      </form>

      <button type="button" onClick={handleDeleteStudent} className="mt-6 rounded border border-red-400 px-4 py-2 text-red-600">
        학생 삭제
      </button>

      <div className="mt-6 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">연결된 보호자</h2>
        <ul className="mt-2 space-y-2">
          {student.guardians.map((link) => (
            <li key={link.id} className="flex items-center justify-between rounded border border-gray-100 p-2">
              <span>
                <span>{link.guardian.name}</span> (<span>{link.guardian.phoneNormalized}</span>) {link.isPrimary && <strong>대표</strong>}
              </span>
              <button type="button" onClick={() => handleUnlinkGuardian(link.id)} className="text-sm text-red-600 underline">
                연결 해제
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleGuardianSearch} className="mt-4 flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span>보호자 검색</span>
            <input
              value={guardianSearch}
              onChange={(event) => setGuardianSearch(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <button type="submit" className="self-end rounded bg-gray-200 px-4 py-2">
            보호자 검색
          </button>
        </form>

        <ul className="mt-2 space-y-1">
          {guardianResults.map((result) => (
            <li key={result.id} className="flex items-center justify-between">
              <span>
                <span>{result.name}</span> ({result.phoneNormalized})
              </span>
              <button type="button" onClick={() => handleLinkGuardian(result.id)} className="text-sm text-blue-600 underline">
                연결
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
