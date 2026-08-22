import { useEffect, useState } from 'react';
import { ApiRequestError, apiGet } from '../../lib/apiClient';

interface AuditLogEntry {
  id: string;
  adminId: string | null;
  roleSnapshot: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result: string;
  createdAt: string;
}

interface AuditLogDetail extends AuditLogEntry {
  beforeDataSafe: unknown;
  afterDataSafe: unknown;
  requestId: string;
}

export function AuditLogsPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [targetType, setTargetType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditLogDetail | null>(null);

  async function load(filterTargetType?: string) {
    const path = filterTargetType ? `/api/audit-logs?targetType=${encodeURIComponent(filterTargetType)}` : '/api/audit-logs';
    setEntries(await apiGet<AuditLogEntry[]>(path));
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

  async function handleFilter() {
    setError(null);
    try {
      await load(targetType || undefined);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    }
  }

  async function handleToggleDetail(entry: AuditLogEntry) {
    if (expandedId === entry.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setError(null);
    setExpandedId(entry.id);
    setDetail(null);
    try {
      setDetail(await apiGet<AuditLogDetail>(`/api/audit-logs/${entry.id}`));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '상세 정보를 불러오지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">감사 로그</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <input
          value={targetType}
          onChange={(event) => setTargetType(event.target.value)}
          placeholder="대상 유형 (예: student, checkIn)"
          className="rounded border border-gray-300 px-3 py-2 text-base"
        />
        <button type="button" onClick={handleFilter} className="rounded bg-gray-200 px-4 py-2">
          필터
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded border border-gray-200 p-3 text-sm">
            <button type="button" onClick={() => handleToggleDetail(entry)} className="w-full text-left">
              <div className="flex items-center justify-between">
                <span className="font-medium">{entry.action}</span>
                <span className={entry.result === 'success' ? 'text-green-700' : 'text-red-600'}>{entry.result}</span>
              </div>
              <p className="text-gray-500">
                {entry.targetType}
                {entry.targetId ? ` #${entry.targetId}` : ''} · {entry.roleSnapshot ?? '알 수 없음'} · {entry.createdAt}
              </p>
            </button>
            {expandedId === entry.id && (
              <div className="mt-2 rounded bg-gray-50 p-2">
                {detail ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-gray-500">변경 전</p>
                      <pre className="overflow-x-auto text-xs">{JSON.stringify(detail.beforeDataSafe, null, 2) ?? '없음'}</pre>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">변경 후</p>
                      <pre className="overflow-x-auto text-xs">{JSON.stringify(detail.afterDataSafe, null, 2) ?? '없음'}</pre>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">불러오는 중...</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
