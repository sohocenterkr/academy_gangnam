import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface MaskedGuardian {
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

type CreateGuardianResponse =
  | { status: 'created'; guardian: { id: string } }
  | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

export function GuardianListPage() {
  const [guardians, setGuardians] = useState<MaskedGuardian[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadGuardians(query?: string) {
    const path = query ? `/api/guardians?search=${encodeURIComponent(query)}` : '/api/guardians';
    setGuardians(await apiGet<MaskedGuardian[]>(path));
  }

  useEffect(() => {
    async function load() {
      try {
        await loadGuardians();
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
      await loadGuardians(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '검색하지 못했습니다.');
    }
  }

  async function submitCreate(confirmDuplicate: boolean) {
    setError(null);
    try {
      const response = await apiPost<CreateGuardianResponse>('/api/guardians', { name, phone, notes, confirmDuplicate });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        return;
      }
      setDuplicates(null);
      setName('');
      setPhone('');
      setNotes('');
      await loadGuardians(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '보호자를 등록하지 못했습니다.');
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitCreate(false);
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">보호자 관리</h1>
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
        {guardians.map((guardian) => (
          <li key={guardian.id} className="rounded border border-gray-200 p-2">
            <Link href={`/admin/guardians/${guardian.id}`} className="text-blue-600 underline">
              {guardian.name}
            </Link>
            <span className="ml-2 text-gray-600">{guardian.phoneNormalized}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 보호자 등록</h2>
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
                  {candidate.name} ({candidate.phoneNormalized})
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => submitCreate(true)}
              className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white"
            >
              그래도 등록
            </button>
          </div>
        )}

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          보호자 등록
        </button>
      </form>
    </section>
  );
}
