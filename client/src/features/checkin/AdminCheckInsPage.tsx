import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface CheckIn {
  id: string;
  studentId: string;
  studentName: string;
  checkInDate: string;
  checkInAt: string;
  source: string;
  status: string;
  exceptionReason: string | null;
  updatedAt: string;
}

interface StudentSearchResult {
  id: string;
  name: string;
  phoneNormalized: string;
}

export function AdminCheckInsPage() {
  const [rows, setRows] = useState<CheckIn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<StudentSearchResult[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentSearchResult | null>(null);
  const [manualReason, setManualReason] = useState('');
  const [allowException, setAllowException] = useState(false);

  async function load() {
    try {
      setRows(await apiGet<CheckIn[]>('/api/check-ins'));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    }
  }

  async function handleCancel(id: string) {
    const reason = window.prompt('취소 사유를 입력해 주세요');
    if (!reason) return;
    setError(null);
    try {
      await apiPost(`/api/check-ins/${id}/cancel`, { reason });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '취소하지 못했습니다.');
    }
  }

  async function handleStudentSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const path = studentQuery ? `/api/students?search=${encodeURIComponent(studentQuery)}` : '/api/students';
      setStudentResults(await apiGet<StudentSearchResult[]>(path));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학생을 검색하지 못했습니다.');
    }
  }

  async function handleManualCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!selectedStudent) {
      setError('학생을 먼저 검색해서 선택해 주세요.');
      return;
    }
    try {
      await apiPost('/api/check-ins/manual', { studentId: selectedStudent.id, reason: manualReason, allowException });
      setSelectedStudent(null);
      setStudentQuery('');
      setStudentResults([]);
      setManualReason('');
      setAllowException(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '수동 등원 등록에 실패했습니다.');
    }
  }

  useEffect(() => {
    async function loadOnMount() {
      await load();
    }
    void loadOnMount();
  }, []);

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">등원 조회</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <form onSubmit={handleStudentSearch} className="mt-4 flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span>학생 검색</span>
          <input
            value={studentQuery}
            onChange={(event) => setStudentQuery(event.target.value)}
            placeholder="이름 또는 전화번호"
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <button type="submit" className="self-end rounded bg-gray-200 px-4 py-2">
          검색
        </button>
      </form>

      {studentResults.length > 0 && !selectedStudent && (
        <ul className="mt-2 space-y-1">
          {studentResults.map((student) => (
            <li key={student.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedStudent(student);
                  setStudentResults([]);
                }}
                className="w-full rounded border border-gray-200 p-2 text-left"
              >
                {student.name} — {student.phoneNormalized}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleManualCreate} className="mt-4 flex flex-col gap-2 rounded border border-gray-200 p-3">
        <h2 className="font-medium">수동 등원 등록</h2>
        <p>
          {selectedStudent ? (
            <>
              선택된 학생: <strong>{selectedStudent.name}</strong> ({selectedStudent.phoneNormalized})
              <button type="button" onClick={() => setSelectedStudent(null)} className="ml-2 text-sm text-gray-500 underline">
                다시 선택
              </button>
            </>
          ) : (
            <span className="text-gray-500">위에서 학생을 검색해 선택해 주세요.</span>
          )}
        </p>
        <label className="flex flex-col gap-1">
          <span>사유</span>
          <input
            value={manualReason}
            onChange={(event) => setManualReason(event.target.value)}
            required
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allowException} onChange={(event) => setAllowException(event.target.checked)} />
          <span>예외 등원 허용 (이미 등원 기록이 있어도 추가 등록)</span>
        </label>
        <button type="submit" className="mt-1 self-start rounded bg-blue-600 px-4 py-2 text-white">
          수동 등원 등록
        </button>
      </form>

      <ul className="mt-4 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between rounded border border-gray-200 p-2">
            <div>
              {row.studentName} — {row.checkInDate} — <span>{row.status}</span> ({row.source})
            </div>
            {row.status === 'active' && (
              <button type="button" onClick={() => handleCancel(row.id)} className="text-sm text-red-600 underline">
                취소
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
