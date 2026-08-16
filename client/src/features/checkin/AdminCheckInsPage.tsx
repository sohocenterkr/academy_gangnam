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

export function AdminCheckInsPage() {
  const [rows, setRows] = useState<CheckIn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualStudentId, setManualStudentId] = useState('');
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

  async function handleManualCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/check-ins/manual', { studentId: manualStudentId, reason: manualReason, allowException });
      setManualStudentId('');
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

      <form onSubmit={handleManualCreate} className="mt-4 flex flex-col gap-2 rounded border border-gray-200 p-3">
        <h2 className="font-medium">수동 등원 등록</h2>
        <label className="flex flex-col gap-1">
          <span>학생 ID</span>
          <input
            value={manualStudentId}
            onChange={(event) => setManualStudentId(event.target.value)}
            required
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
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
