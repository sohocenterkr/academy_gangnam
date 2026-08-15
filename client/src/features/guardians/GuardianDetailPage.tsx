import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ApiRequestError, apiGet, apiPatch } from '../../lib/apiClient';

interface Guardian {
  id: string;
  name: string;
  phoneNormalized: string;
  notes: string | null;
  updatedAt: string;
}

interface DuplicateCandidate {
  id: string;
  name: string;
  phoneNormalized: string;
}

type UpdateGuardianResponse =
  | { status: 'updated'; guardian: Guardian }
  | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

export function GuardianDetailPage() {
  const params = useParams<{ guardianId: string }>();
  const guardianId = params.guardianId;

  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guardianId) return;

    async function loadGuardian(id: string) {
      try {
        const data = await apiGet<Guardian>(`/api/guardians/${id}`);
        setGuardian(data);
        setName(data.name);
        setPhone(data.phoneNormalized);
        setNotes(data.notes ?? '');
        setStatus('idle');
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
        setStatus('error');
      }
    }

    void loadGuardian(guardianId);
  }, [guardianId]);

  async function submitUpdate(confirmDuplicate: boolean) {
    if (!guardian) return;
    setStatus('saving');
    setError(null);
    try {
      const response = await apiPatch<UpdateGuardianResponse>(`/api/guardians/${guardian.id}`, {
        name,
        phone,
        notes,
        confirmDuplicate,
        expectedUpdatedAt: guardian.updatedAt,
      });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        setStatus('idle');
        return;
      }
      setDuplicates(null);
      setGuardian(response.guardian);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
      setStatus('error');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitUpdate(false);
  }

  if (status === 'loading') return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!guardian) {
    return (
      <section className="p-4">
        <Link href="/admin/guardians" className="text-blue-600 underline">
          목록으로
        </Link>
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error ?? '보호자를 찾을 수 없습니다.'}
        </p>
      </section>
    );
  }

  return (
    <section className="p-4">
      <Link href="/admin/guardians" className="text-blue-600 underline">
        목록으로
      </Link>
      <h1 className="mt-2 text-xl font-semibold">보호자 상세</h1>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
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
          <span>메모</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>

        {duplicates && duplicates.length > 0 && (
          <div role="alert" className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm">
            <p>이미 등록된 전화번호와 일치하는 보호자가 있습니다:</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.map((candidate) => (
                <li key={candidate.id}>
                  <Link href={`/admin/guardians/${candidate.id}`} className="underline">
                    {candidate.name}
                  </Link>{' '}
                  ({candidate.phoneNormalized})
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => submitUpdate(true)}
              className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white"
            >
              그래도 저장
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {status === 'saved' && <p className="text-sm text-green-700">저장되었습니다.</p>}

        <button
          type="submit"
          disabled={status === 'saving'}
          className="self-start rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          저장
        </button>
      </form>
    </section>
  );
}
