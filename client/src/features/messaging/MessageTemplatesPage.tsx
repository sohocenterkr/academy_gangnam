import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiDelete, apiGet, apiPost } from '../../lib/apiClient';

interface Template {
  id: string;
  name: string;
  category: string | null;
  messageType: 'informational' | 'marketing';
  body: string;
  description: string | null;
  status: 'active' | 'inactive';
  usageCount: number;
}

const MESSAGE_TYPE_LABELS: Record<Template['messageType'], string> = {
  informational: '정보성',
  marketing: '광고성',
};

export function MessageTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [messageType, setMessageType] = useState<Template['messageType']>('informational');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setTemplates(await apiGet<Template[]>('/api/message-templates'));
  }

  useEffect(() => {
    async function loadOnMount() {
      try {
        await load();
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
      await apiPost('/api/message-templates', { name, messageType, body });
      setName('');
      setBody('');
      setMessageType('informational');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '템플릿을 등록하지 못했습니다.');
    }
  }

  async function handleCopy(id: string) {
    setError(null);
    try {
      await apiPost(`/api/message-templates/${id}/copy`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '복사하지 못했습니다.');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('이 템플릿을 삭제할까요?')) return;
    setError(null);
    try {
      await apiDelete(`/api/message-templates/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '삭제하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">문자 템플릿</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {templates.map((template) => (
          <li key={template.id} className="rounded border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">{template.name}</span>
                <span className="ml-2 text-sm text-gray-500">{MESSAGE_TYPE_LABELS[template.messageType]}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <button type="button" onClick={() => handleCopy(template.id)} className="text-blue-600 underline">
                  복사
                </button>
                <button type="button" onClick={() => handleDelete(template.id)} className="text-red-600 underline">
                  삭제
                </button>
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{template.body}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 템플릿 등록</h2>
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
          <span>유형</span>
          <select
            value={messageType}
            onChange={(event) => setMessageType(event.target.value as Template['messageType'])}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          >
            <option value="informational">정보성</option>
            <option value="marketing">광고성</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>본문 ({'{{이름}}'} 사용 가능)</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            rows={4}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          템플릿 등록
        </button>
      </form>
    </section>
  );
}
