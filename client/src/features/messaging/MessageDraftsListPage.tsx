import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface Draft {
  id: string;
  name: string;
  status: string;
  messageType: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: '초안',
  validating: '검증 중',
  ready: '준비됨',
  scheduled: '예약됨',
  queued: '발송대기',
  dispatching: '발송 중',
  partial: '일부 완료',
  completed: '완료',
  failed: '실패',
  canceled: '취소됨',
};

export function MessageDraftsListPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [name, setName] = useState('');
  const [messageType, setMessageType] = useState<'informational' | 'marketing'>('informational');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOnMount() {
      try {
        setDrafts(await apiGet<Draft[]>('/api/message-drafts'));
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void loadOnMount();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const created = await apiPost<Draft>('/api/message-drafts', { name, messageType });
      setDrafts((prev) => [created, ...prev]);
      setName('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '초안을 만들지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">문자 발송</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {drafts.map((draft) => (
          <li key={draft.id} className="rounded border border-gray-200 p-3">
            <Link href={`/admin/messaging/drafts/${draft.id}`} className="text-blue-600 underline">
              {draft.name}
            </Link>
            <span className="ml-2 text-sm text-gray-500">{STATUS_LABELS[draft.status] ?? draft.status}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 문자 발송 만들기</h2>
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>유형</span>
          <select
            value={messageType}
            onChange={(event) => setMessageType(event.target.value as 'informational' | 'marketing')}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          >
            <option value="informational">정보성</option>
            <option value="marketing">광고성</option>
          </select>
        </label>
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          만들기
        </button>
      </form>
    </section>
  );
}
