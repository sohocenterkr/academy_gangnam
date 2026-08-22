import { useEffect, useState } from 'react';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface Campaign {
  id: string;
  name: string;
  status: string;
  sendMode: string;
  scheduledAt: string | null;
  totalContacts: number;
  totalSendItems: number;
  failedCount: number;
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

export function MessageCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setCampaigns(await apiGet<Campaign[]>('/api/message-campaigns'));
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

  async function handleDispatch(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await apiPost(`/api/message-campaigns/${id}/dispatch`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '발송 처리에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm('이 발송 작업을 취소할까요?')) return;
    setError(null);
    setBusyId(id);
    try {
      await apiPost(`/api/message-campaigns/${id}/cancel`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '취소하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRetry(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await apiPost(`/api/message-campaigns/${id}/retry`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '재발송 준비에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">문자 발송 현황</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {campaigns.map((campaign) => (
          <li key={campaign.id} className="rounded border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">{campaign.name}</span>
                <span className="ml-2 text-sm text-gray-500">{STATUS_LABELS[campaign.status] ?? campaign.status}</span>
              </div>
              <div className="flex gap-2 text-sm">
                {(campaign.status === 'queued' || campaign.status === 'scheduled') && (
                  <button type="button" onClick={() => handleDispatch(campaign.id)} disabled={busyId === campaign.id} className="text-blue-600 underline disabled:opacity-50">
                    지금 발송
                  </button>
                )}
                {['draft', 'ready', 'scheduled', 'queued'].includes(campaign.status) && (
                  <button type="button" onClick={() => handleCancel(campaign.id)} disabled={busyId === campaign.id} className="text-red-600 underline disabled:opacity-50">
                    취소
                  </button>
                )}
                {['partial', 'failed'].includes(campaign.status) && (
                  <button type="button" onClick={() => handleRetry(campaign.id)} disabled={busyId === campaign.id} className="text-blue-600 underline disabled:opacity-50">
                    실패 건 재발송
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              대상 {campaign.totalContacts}명 · 발송건수 {campaign.totalSendItems}건 · 실패 {campaign.failedCount}건
              {campaign.scheduledAt && ` · 예약: ${campaign.scheduledAt}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
