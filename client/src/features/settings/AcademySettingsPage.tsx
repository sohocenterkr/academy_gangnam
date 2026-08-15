import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiGet, apiPatch } from '../../lib/apiClient';

interface AcademySettings {
  id: string;
  academyName: string;
  phoneNormalized: string | null;
  address: string | null;
  senderName: string | null;
  updatedAt: string;
}

export function AcademySettingsPage() {
  const [settings, setSettings] = useState<AcademySettings | null>(null);
  const [academyName, setAcademyName] = useState('');
  const [phoneNormalized, setPhoneNormalized] = useState('');
  const [address, setAddress] = useState('');
  const [senderName, setSenderName] = useState('');
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AcademySettings>('/api/settings/academy')
      .then((data) => {
        setSettings(data);
        setAcademyName(data.academyName);
        setPhoneNormalized(data.phoneNormalized ?? '');
        setAddress(data.address ?? '');
        setSenderName(data.senderName ?? '');
        setStatus('idle');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
        setStatus('error');
      });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setStatus('saving');
    setError(null);
    try {
      const updated = await apiPatch<AcademySettings>('/api/settings/academy', {
        academyName,
        phoneNormalized,
        address,
        senderName,
      });
      setSettings(updated);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
      setStatus('error');
    }
  }

  if (status === 'loading') return <p className="p-4 text-gray-500">불러오는 중...</p>;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">학원 기본정보</h1>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>학원 이름</span>
          <input
            value={academyName}
            onChange={(event) => setAcademyName(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>전화번호</span>
          <input
            value={phoneNormalized}
            onChange={(event) => setPhoneNormalized(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>주소</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>발신자명</span>
          <input
            value={senderName}
            onChange={(event) => setSenderName(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {status === 'saved' && <p className="text-sm text-green-700">저장되었습니다.</p>}
        <button
          type="submit"
          disabled={status === 'saving'}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          저장
        </button>
      </form>
    </section>
  );
}
