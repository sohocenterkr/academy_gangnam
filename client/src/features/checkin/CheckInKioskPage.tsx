import { type FormEvent, useState } from 'react';
import { ApiRequestError, apiPost } from '../../lib/apiClient';

interface Candidate {
  selectionToken: string;
  maskedName: string;
}

type SearchResponse = { status: 'no_match' } | { status: 'candidates'; candidates: Candidate[] };
type ConfirmResponse = { status: 'confirmed'; checkInAt: string; maskedName: string };

export function CheckInKioskPage() {
  const [last4, setLast4] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [confirmed, setConfirmed] = useState<{ maskedName: string; checkInAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resetAndSearchAgain() {
    setLast4('');
    setCandidates(null);
    setNoMatch(false);
    setConfirmed(null);
    setError(null);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNoMatch(false);
    setCandidates(null);
    try {
      const response = await apiPost<SearchResponse>('/api/check-in/search', { last4 });
      if (response.status === 'no_match') {
        setNoMatch(true);
        return;
      }
      setCandidates(response.candidates);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '검색하지 못했습니다.');
    }
  }

  async function handleConfirm(selectionToken: string) {
    setError(null);
    try {
      const response = await apiPost<ConfirmResponse>('/api/check-in/confirm', { selectionToken });
      setConfirmed({ maskedName: response.maskedName, checkInAt: response.checkInAt });
      setCandidates(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '등원 처리에 실패했습니다.');
    }
  }

  if (confirmed) {
    return (
      <section className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <p className="text-2xl font-semibold">
          {confirmed.maskedName}님, 환영합니다! 등원 처리가 완료되었습니다.
        </p>
        <button type="button" onClick={resetAndSearchAgain} className="mt-6 rounded bg-blue-600 px-6 py-3 text-white">
          처음으로
        </button>
      </section>
    );
  }

  return (
    <section className="flex min-h-screen flex-col items-center justify-center p-4">
      <h1 className="text-xl font-semibold">등원 체크인</h1>

      {!candidates && (
        <form onSubmit={handleSearch} className="mt-6 flex flex-col items-center gap-3">
          <label className="flex flex-col items-center gap-1">
            <span>전화번호 뒤 4자리</span>
            <input
              value={last4}
              onChange={(event) => setLast4(event.target.value)}
              inputMode="numeric"
              maxLength={4}
              required
              className="w-40 rounded border border-gray-300 px-3 py-3 text-center text-2xl"
            />
          </label>
          <button type="submit" className="rounded bg-blue-600 px-8 py-3 text-lg text-white">
            등원
          </button>
        </form>
      )}

      {noMatch && (
        <p role="alert" className="mt-4 text-red-600">
          등록된 학생을 찾을 수 없습니다. 관리자에게 문의해 주세요.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-red-600">
          {error}
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <p>본인 이름을 선택해 주세요</p>
          {candidates.map((candidate) => (
            <button
              key={candidate.selectionToken}
              type="button"
              onClick={() => handleConfirm(candidate.selectionToken)}
              className="rounded border border-gray-300 px-6 py-3 text-lg"
            >
              {candidate.maskedName}
            </button>
          ))}
          <button type="button" onClick={resetAndSearchAgain} className="mt-2 text-sm text-gray-500 underline">
            다시 검색
          </button>
        </div>
      )}
    </section>
  );
}
